import 'server-only'

import { and, eq, getTableColumns, inArray } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import {
  apiKeys,
  apps,
  devices,
  instanceSetup,
  receivingAccounts,
  webhookEndpoints,
} from '@/lib/db/schema'

/**
 * Whether this instance can actually take a payment yet.
 *
 * A fresh deployment has an admin and nothing else, and the dashboard it lands
 * on is six screens of empty tables that give no hint which one to start with.
 * Worse, most of the empty states are indistinguishable from "quiet day".
 *
 * So the state is computed from what exists rather than from a flag somebody
 * ticks. Nothing here can be marked done without the thing being genuinely
 * present — you cannot dismiss your way to a working instance, and re-deleting
 * an account puts the wizard back.
 *
 * The four required steps are the real dependency chain, in order:
 *
 *   phone paired  ->  number chosen from its SIMs  ->  enabled  ->  business + key
 *
 * The first two used to be the other way round: type a number, then connect a
 * phone to it. That asked somebody to key in a bKash number before anything
 * could check it against the SIM the messages would actually arrive on, and
 * when the two disagreed the symptom was payments quietly not arriving. Pairing
 * first means the phone reports its SIMs and the number is *chosen*, not typed.
 *
 * A webhook endpoint is listed but optional, because a store can poll
 * `GET /v1/intents/:id` instead. It is still the last card, because polling is
 * the worse choice and most people want to be told.
 */

export type SetupStepId = 'phone' | 'account' | 'enable' | 'app' | 'key' | 'endpoint'

export interface SetupStep {
  id: SetupStepId
  title: string
  /** What this step is for, in one line. */
  blurb: string
  done: boolean
  /** False for the webhook endpoint — useful, not load-bearing. */
  required: boolean
  /** Filled in when done, so the wizard can show what it found. */
  detail: string | null
}

export interface SetupState {
  steps: SetupStep[]
  /** Every *required* step satisfied. */
  complete: boolean
  /** The first unfinished step, or null. Where the wizard opens. */
  currentStepId: SetupStepId | null
  /** Ids the wizard needs so a step can act without another round trip. */
  firstAccountId: string | null
  firstAppId: string | null
  /** The paired phone whose SIMs the number is chosen from, once there is one. */
  firstDeviceId: string | null
  /**
   * The phones, so the first step can be about all of them rather than one.
   *
   * A business runs more than one — a till phone and a back-office phone, or
   * one per SIM — and the schema has always allowed it. The wizard showed a
   * single phone and moved on, which made "connect another" something you had
   * to know to do somewhere else.
   *
   * `pending` are phones that have scanned and are waiting: scanning earns
   * nothing on its own, because a QR gets screenshotted and forwarded, so each
   * one needs approving or turning away.
   */
  connectedPhones: { id: string; name: string }[]
  pendingPhones: { id: string; name: string }[]
}

/**
 * The phones, split by what the wizard needs to say about each.
 *
 * A device only counts as connected once it has exchanged its provisioning code
 * for a real token — a row without one is a QR nobody has scanned. Of those, an
 * `awaiting_approval` phone has scanned and is waiting to be let in, which is a
 * state the wizard has to offer an action for rather than merely describe.
 */
/**
 * One entry per handset, not one per credential.
 *
 * A phone holds a separate device row for each number it watches — that is what
 * keeps revoking a bKash number from also killing a Nagad one — plus the
 * account-less row it paired with. All of them are the same piece of glass, and
 * counting rows meant one phone reported itself as "2 connected" the moment
 * somebody chose a SIM for it, then three when they added a second wallet.
 *
 * `installId` is what a handset actually is; the row id is what a credential
 * is. Falling back to the row id keeps a legacy phone that reports no handset
 * counted exactly as it was before, rather than collapsing several into one.
 */
function byHandset(rows: (typeof devices.$inferSelect)[]) {
  const seen = new Map<string, typeof devices.$inferSelect>()
  for (const row of rows) {
    const handset = row.installId ?? row.id
    // Keep the earliest, so the entry the operator approved is the one named —
    // and so the id stays put rather than moving each time a number is added.
    const held = seen.get(handset)
    if (!held || row.createdAt < held.createdAt) seen.set(handset, row)
  }
  return [...seen.values()]
}

function partitionPhones(all: (typeof devices.$inferSelect)[]) {
  const provisioned = all.filter(
    (device) => device.provisionedAt !== null && device.tokenHash !== null,
  )

  const connected = byHandset(provisioned.filter((device) => device.status === 'active'))

  return {
    phone: connected[0] ?? null,
    connected,
    pending: byHandset(all.filter((device) => device.status === 'awaiting_approval')),
  }
}

export async function getSetupState(businessId: string): Promise<SetupState> {
  const [accounts, allApps, allKeys, allEndpoints, allDevices] = await Promise.all([
    db.select().from(receivingAccounts).where(eq(receivingAccounts.businessId, businessId)),
    db.select().from(apps).where(eq(apps.businessId, businessId)),
    db
      .select({ ...getTableColumns(apiKeys) })
      .from(apiKeys)
      .innerJoin(apps, eq(apiKeys.appId, apps.id))
      .where(and(eq(apiKeys.status, 'active'), eq(apps.businessId, businessId))),
    db
      .select({ ...getTableColumns(webhookEndpoints) })
      .from(webhookEndpoints)
      .innerJoin(apps, eq(webhookEndpoints.appId, apps.id))
      .where(and(eq(webhookEndpoints.status, 'active'), eq(apps.businessId, businessId))),
    db
      .select({ ...getTableColumns(devices) })
      /*
       * By business, not through an account. A phone paired to the business
       * with no number bound yet is the whole point of the first step, and
       * joining through `receiving_accounts` would make it invisible.
       */
      .from(devices)
      /*
       * Both statuses, because a phone that has scanned is not yet `active`.
       *
       * Approval is a deliberate second step — a QR is a bearer credential, so
       * scanning one earns nothing until somebody says so. Selecting only
       * `active` made that phone invisible here, and the wizard sat on "this
       * checks itself every few seconds once you scan" forever while the phone
       * said it was waiting for an approval the wizard never offered.
       */
      .where(
        and(
          inArray(devices.status, ['active', 'awaiting_approval']),
          eq(devices.businessId, businessId),
        ),
      ),
  ])

  const account = accounts[0] ?? null
  const app = allApps[0] ?? null

  // A device only counts once it has exchanged its provisioning code for a
  // real token. A `pending` row is a QR nobody has scanned yet.
  const { phone, connected, pending } = partitionPhones(allDevices)

  const enabled = accounts.filter((candidate) => candidate.status === 'active')
  const keysForApp = app ? allKeys.filter((key) => key.appId === app.id) : []
  const endpointsForApp = app ? allEndpoints.filter((e) => e.appId === app.id) : []

  const steps: SetupStep[] = [
    {
      id: 'phone',
      title: 'Connect a phone',
      blurb: 'Install the app and scan the code. It reads the SIMs in the phone.',
      done: phone !== null,
      required: true,
      detail: phone
        ? `${connected.length} connected`
        : pending.length > 0
          ? `${pending.length} scanned — approve below`
          : null,
    },
    {
      id: 'account',
      title: 'Choose the SIM you get paid on',
      blurb: 'The number comes off the SIM, so there is nothing to type.',
      done: account !== null,
      required: true,
      detail: account ? `${accounts.length} added` : null,
    },
    {
      id: 'enable',
      title: 'Turn the account on',
      blurb:
        'Accounts start off so checkout cannot route to a number nobody watches. ' +
        'Turning one on makes it live to buyers.',
      done: enabled.length > 0,
      required: true,
      detail: enabled.length > 0 ? `${enabled.length} routable` : null,
    },
    {
      id: 'app',
      title: 'Create your business',
      blurb: 'One business is one storefront, with its own keys and payments.',
      done: app !== null,
      required: true,
      detail: app ? app.name : null,
    },
    {
      id: 'key',
      title: 'Generate an API key',
      blurb: 'What your store sends with every request. Shown once.',
      done: keysForApp.length > 0,
      required: true,
      detail: keysForApp.length > 0 ? `${keysForApp.length} active` : null,
    },
    {
      id: 'endpoint',
      title: 'Point a webhook at your store',
      blurb: 'How your store is told a payment arrived. Skippable if you poll instead.',
      done: endpointsForApp.length > 0,
      required: false,
      detail: endpointsForApp.length > 0 ? (endpointsForApp[0]?.url ?? null) : null,
    },
  ]

  const complete = steps.every((step) => step.done || !step.required)

  return {
    steps,
    complete,
    currentStepId: steps.find((step) => !step.done)?.id ?? null,
    firstAccountId: account?.id ?? null,
    firstDeviceId: phone?.id ?? null,
    connectedPhones: connected.map((device) => ({ id: device.id, name: device.name })),
    pendingPhones: pending.map((device) => ({ id: device.id, name: device.name })),
    firstAppId: app?.id ?? null,
  }
}

/**
 * Has this instance ever finished setting up?
 *
 * The question the wizard is gated on, and deliberately not the same as "can it
 * take a payment right now". Disabling an account is a one-click action on the
 * Accounts page — the documented way to take a number out of rotation when a
 * phone is away for the day — and doing that to your only account should not
 * throw an operator back into a first-run wizard, locking them out of their own
 * payment history to re-tick boxes they ticked weeks ago.
 *
 * Deleting a row does not un-happen the past. So this reads a stamp, not the
 * live tables.
 */
export async function hasCompletedSetup(): Promise<boolean> {
  const [row] = await db
    .select({ completedAt: instanceSetup.completedAt })
    .from(instanceSetup)
    .limit(1)

  return row?.completedAt != null
}

/**
 * Stamped once, the first time every required step is satisfied, and never
 * cleared. Safe to call repeatedly — the singleton primary key makes a second
 * call a no-op rather than a second row.
 */
export async function markSetupComplete(): Promise<void> {
  await db
    .insert(instanceSetup)
    .values({ id: true, completedAt: new Date(), completedBy: 'setup-wizard' })
    .onConflictDoNothing({ target: instanceSetup.id })
}

/**
 * Whether a payment could be taken *this second*.
 *
 * Separate from the question above on purpose. A `false` here on an instance
 * that has completed setup is an operational problem worth a banner, not a
 * reason to hide the dashboard.
 */
export async function canTakePayments(businessId: string): Promise<boolean> {
  const [account] = await db
    .select({ id: receivingAccounts.id })
    .from(receivingAccounts)
    .where(
      and(eq(receivingAccounts.status, 'active'), eq(receivingAccounts.businessId, businessId)),
    )
    .limit(1)

  if (!account) return false

  const [key] = await db
    .select({ id: apiKeys.id })
    .from(apiKeys)
    .innerJoin(apps, eq(apiKeys.appId, apps.id))
    .where(and(eq(apiKeys.status, 'active'), eq(apps.businessId, businessId)))
    .limit(1)

  if (!key) return false

  const [device] = await db
    .select({ id: devices.id })
    .from(devices)
    .where(and(eq(devices.status, 'active'), eq(devices.receivingAccountId, account.id)))
    .limit(1)

  return Boolean(device)
}
