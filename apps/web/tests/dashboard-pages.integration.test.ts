import { randomBytes, randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db, pool } from '@/lib/db/client'
import {
  apps,
  businesses,
  devices,
  incomingPayments,
  paymentIntents,
  receivingAccounts,
  users,
} from '@/lib/db/schema'
import { listAccountAlerts } from '@/lib/services/account-admin'
import { listAccountHealth } from '@/lib/services/accounts'
import { listApps } from '@/lib/services/app-admin'
import { listBusinessesForReview } from '@/lib/services/businesses'
import {
  getFeed,
  getOverdueIntentCount,
  getPaidWithoutPaymentCount,
  getParseFailureCount,
  getQueueDepth,
} from '@/lib/services/dashboard'
import { listDevices } from '@/lib/services/devices'
import { getIntentFilterOptions, listIntents } from '@/lib/services/intent-admin'
import { getSetupState } from '@/lib/services/onboarding'
import { getQueue } from '@/lib/services/queue'
import { listPairedPhones } from '@/lib/services/sim-accounts'

/**
 * Every query a dashboard page makes, run once against a real database.
 *
 * These exist because nothing else ran them. The unit suite mocks the database,
 * the API smoke scripts never open a page, and the integration tests covered
 * services reached through `/v1` and `/device/v1` — so the dashboard's own
 * reads were only ever executed by a human looking at the screen.
 *
 * `getIntentFilterOptions` is why. It counted intents with raw SQL:
 *
 *     count(*) filter (where status = 'open')
 *
 * over a join with `apps`, which has a `status` column of its own. Postgres
 * refuses an ambiguous reference outright (42702), so the statement failed, and
 * because the page awaits it in a `Promise.all` the whole of `/intents` was a
 * 500 — not a missing count, the entire page. Raw SQL is invisible to the query
 * builder and to `tsc`, so nothing failed until somebody loaded the route.
 *
 * The assertions are deliberately shallow. What is being proved is that each
 * query is *valid SQL against the current schema* — the failure mode that ships
 * silently and takes a page down. Asserting on the figures would make this a
 * test of the seed data instead.
 */

let businessId: string
let appId: string
let accountId: string
let actorId: string

beforeAll(async () => {
  actorId = randomUUID()
  await db.insert(users).values({ id: actorId, name: 'Pages', email: `${actorId}@test.local` })

  const slug = `pages-${randomBytes(4).toString('hex')}`
  const [business] = await db
    .insert(businesses)
    .values({ name: 'Pages Shop', slug, status: 'active' })
    .returning({ id: businesses.id })
  businessId = business?.id ?? ''

  const [app] = await db
    .insert(apps)
    .values({ businessId, name: `${slug} app`, slug: `${slug}-app` })
    .returning({ id: apps.id })
  appId = app?.id ?? ''

  const [account] = await db
    .insert(receivingAccounts)
    .values({
      businessId,
      provider: 'bkash',
      msisdn: `8809${randomBytes(5).toString('hex').replace(/\D/g, '').padEnd(9, '1').slice(0, 9)}`,
      label: `${slug} phone`,
      status: 'active',
      lastHeartbeatAt: new Date(),
    })
    .returning({ id: receivingAccounts.id })
  accountId = account?.id ?? ''

  await db.insert(devices).values({ businessId, name: 'Counter phone', status: 'active' })

  // One intent, so the counting queries have something to count rather than
  // taking the empty-table path past the bug.
  await db.insert(paymentIntents).values({
    appId,
    receivingAccountId: accountId,
    amountCents: 12_345,
    // The reference code is not a column here — it lives in its own table, with
    // its own lifecycle, because one intent can be reissued a code.
    clientReference: `PAGES-${randomBytes(4).toString('hex')}`,
    status: 'open',
    ttlSeconds: 600,
    expiresAt: new Date(Date.now() + 600_000),
  })
})

afterAll(async () => {
  await db.delete(paymentIntents).where(eq(paymentIntents.receivingAccountId, accountId))
  await db.delete(incomingPayments).where(eq(incomingPayments.receivingAccountId, accountId))
  await db.delete(devices).where(eq(devices.businessId, businessId))
  await db.delete(businesses).where(eq(businesses.id, businessId))
  await db.delete(users).where(eq(users.id, actorId))
  await pool.end()
})

/** Each entry is one page's data loader, named for the route it serves. */
const pages: [string, () => Promise<unknown>][] = [
  ['/ (feed)', () => getFeed(businessId, { limit: 300 })],
  ['/queue', () => getQueue(businessId)],
  ['/intents — list', () => listIntents(businessId)],
  ['/intents — filter counts', () => getIntentFilterOptions(businessId)],
  ['/accounts — health', () => listAccountHealth(businessId)],
  // These two are per-account rather than per-business: the page fans out over
  // the accounts it just listed.
  ['/accounts — alerts', () => listAccountAlerts(accountId)],
  ['/accounts — devices', () => listDevices(accountId)],
  ['/accounts — paired phones', () => listPairedPhones(businessId)],
  ['/apps', () => listApps(businessId)],
  ['/reconcile — paid without payment', () => getPaidWithoutPaymentCount(businessId)],
  ['/reconcile — overdue', () => getOverdueIntentCount(businessId)],
  ['/reconcile — parse failures', () => getParseFailureCount(businessId)],
  ['/reconcile — queue depth', () => getQueueDepth(businessId)],
  ['/setup', () => getSetupState(businessId)],
  ['/admin', () => listBusinessesForReview()],
]

describe('every dashboard page can load its data', () => {
  for (const [route, load] of pages) {
    it(`${route} runs without a database error`, async () => {
      await expect(load()).resolves.toBeDefined()
    })
  }
})

describe('the intents filter counts', () => {
  it('counts the business’s own intents and nobody else’s', async () => {
    /*
     * The specific regression. A bare `status` in the raw count is ambiguous
     * once `apps` is joined, so this asserts the query both runs *and* answers
     * about `payment_intents.status` rather than whatever else is in scope.
     */
    const options = await getIntentFilterOptions(businessId)

    expect(options.counts.total).toBe(1)
    expect(options.counts.open).toBe(1)
    expect(options.counts.matched).toBe(0)
    expect(options.counts.partial).toBe(0)
  })
})
