import 'server-only'

import { and, eq, getTableColumns } from 'drizzle-orm'
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
 *   number  ->  phone watching it  ->  account enabled  ->  business + key
 *
 * A webhook endpoint is listed but optional, because a store can poll
 * `GET /v1/intents/:id` instead. It is still the last card, because polling is
 * the worse choice and most people want to be told.
 */

export type SetupStepId = 'account' | 'device' | 'enable' | 'app' | 'key' | 'endpoint'

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
      .from(devices)
      .innerJoin(receivingAccounts, eq(devices.receivingAccountId, receivingAccounts.id))
      .where(and(eq(devices.status, 'active'), eq(receivingAccounts.businessId, businessId))),
  ])

  const account = accounts[0] ?? null
  const app = allApps[0] ?? null

  // A device only counts once it has exchanged its provisioning code for a
  // real token. A `pending` row is a QR nobody has scanned yet.
  const provisioned = allDevices.filter(
    (device) => device.provisionedAt !== null && device.tokenHash !== null,
  )
  const provisionedHere = account
    ? provisioned.filter((device) => device.receivingAccountId === account.id)
    : []

  const enabled = accounts.filter((candidate) => candidate.status === 'active')
  const keysForApp = app ? allKeys.filter((key) => key.appId === app.id) : []
  const endpointsForApp = app ? allEndpoints.filter((e) => e.appId === app.id) : []

  const steps: SetupStep[] = [
    {
      id: 'account',
      title: 'Add the number you get paid on',
      blurb: 'The bKash number buyers send money to. Jomma watches it.',
      done: account !== null,
      required: true,
      detail: account ? `${accounts.length} added` : null,
    },
    {
      id: 'device',
      title: 'Connect the phone that holds that SIM',
      blurb: 'It forwards payment messages to Jomma. Nothing works without it.',
      done: provisionedHere.length > 0,
      required: true,
      detail: provisionedHere.length > 0 ? `${provisionedHere.length} connected` : null,
    },
    {
      id: 'enable',
      title: 'Turn the account on',
      blurb: 'Accounts start off so checkout cannot route to a number nobody watches.',
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
