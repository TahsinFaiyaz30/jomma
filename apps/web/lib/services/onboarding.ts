import 'server-only'

import { and, eq } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { apiKeys, apps, devices, receivingAccounts, webhookEndpoints } from '@/lib/db/schema'

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

export async function getSetupState(): Promise<SetupState> {
  const [accounts, allApps, allKeys, allEndpoints, allDevices] = await Promise.all([
    db.select().from(receivingAccounts),
    db.select().from(apps),
    db.select().from(apiKeys).where(eq(apiKeys.status, 'active')),
    db.select().from(webhookEndpoints).where(eq(webhookEndpoints.status, 'active')),
    db.select().from(devices).where(eq(devices.status, 'active')),
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
 * Cheap enough to run in the dashboard layout on every request.
 *
 * Counts only, no joins — the layout already makes two queries and this must
 * not turn navigation into a survey of the whole database.
 */
export async function isSetupComplete(): Promise<boolean> {
  const [account] = await db
    .select({ id: receivingAccounts.id })
    .from(receivingAccounts)
    .where(eq(receivingAccounts.status, 'active'))
    .limit(1)

  if (!account) return false

  const [key] = await db
    .select({ id: apiKeys.id })
    .from(apiKeys)
    .where(eq(apiKeys.status, 'active'))
    .limit(1)

  if (!key) return false

  const [device] = await db
    .select({ id: devices.id })
    .from(devices)
    .where(and(eq(devices.status, 'active'), eq(devices.receivingAccountId, account.id)))
    .limit(1)

  return Boolean(device)
}
