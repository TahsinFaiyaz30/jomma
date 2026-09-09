import { randomBytes, randomUUID } from 'node:crypto'
import { eq, inArray, sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { db, pool } from '@/lib/db/client'
import { apps, businesses, jobRuns, webhookDeliveries, webhookEndpoints } from '@/lib/db/schema'
import {
  getSchedulerHealth,
  recordJobRun,
  schedulerNeedsAttention,
} from '@/lib/services/scheduler-health'

/**
 * The detector that has to work when nothing else does.
 *
 * Every other alarm in this system is raised by a scheduled job, which leaves
 * exactly one thing unwatched: the scheduler. When it stops, the alerts stop
 * with it, and the symptoms that reach an operator all point somewhere else — a
 * shop's stock never released, an intent `open` past its deadline, a webhook
 * that "never arrived". An instance ran two days like that and every view of it
 * looked healthy.
 *
 * These cover the two questions that were unanswerable then, and the fact that
 * they are *separate*: is anything running, and is what it produces getting
 * out. Different faults, different fixes — "start the worker" against "your
 * endpoint is unreachable" — and a detector that blurs them sends somebody to
 * the wrong place.
 *
 * `getSchedulerHealth` is deliberately instance-wide: a dead scheduler is not
 * one merchant's problem. That makes it global state, so `job_runs` is taken
 * over for the duration and put back afterwards, and delivery counts are
 * asserted as deltas against a baseline rather than absolutes.
 *
 * ## Needs a database
 */

const GROUP = `test-${randomBytes(4).toString('hex')}`

let appId = ''
let businessId = ''
let endpointId = ''
const deliveryIds: string[] = []

/** Whatever the instance already had, restored on the way out. */
let savedRuns: Array<typeof jobRuns.$inferSelect> = []

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000)

/** A queued delivery, aged and attempted however the case needs. */
async function delivery(options: {
  ageMinutes: number
  attempts: number
  status: 'pending' | 'failed'
  nextAttemptAt?: Date
}) {
  const at = minutesAgo(options.ageMinutes)
  const [row] = await db
    .insert(webhookDeliveries)
    .values({
      appId,
      endpointId,
      eventId: `evt_${randomBytes(8).toString('hex')}`,
      eventType: 'payment.succeeded',
      payload: { type: 'payment.succeeded', data: { client_reference: 'SCHED-TEST' } },
      status: options.status,
      attempts: options.attempts,
      nextAttemptAt: options.nextAttemptAt ?? at,
      createdAt: at,
    })
    .returning({ id: webhookDeliveries.id })

  deliveryIds.push(row!.id)
}

/** A live scheduler, so the other half is never what makes a case fail. */
const stampFresh = () => {
  const now = new Date()
  return recordJobRun({
    group: GROUP,
    startedAt: now,
    finishedAt: now,
    durationMs: 1,
    result: {},
  })
}

beforeAll(async () => {
  /*
   * Fixtures first, and the table taken over last.
   *
   * The order matters more than it looks. Emptying `job_runs` before the
   * fixtures exist means a failure while creating them — a missing column, a
   * constraint — leaves the suite aborted with the instance's real stamps
   * deleted and `afterAll` never reached. That is a test that breaks the
   * dashboard it is testing, and it happened once while writing this.
   */
  const slug = `sched-${randomBytes(4).toString('hex')}`
  const [b] = await db
    .insert(businesses)
    .values({ name: 'Scheduler', slug, status: 'active' })
    .returning({ id: businesses.id })
  businessId = b!.id

  const [a] = await db
    .insert(apps)
    .values({ businessId, name: 'Shop', slug: `${slug}-app` })
    .returning({ id: apps.id })
  appId = a!.id

  const [e] = await db
    .insert(webhookEndpoints)
    .values({
      appId,
      url: `https://example.com/${randomUUID()}`,
      secret: randomBytes(16).toString('hex'),
      enabledEvents: ['payment.succeeded'],
      status: 'active',
    })
    .returning({ id: webhookEndpoints.id })
  endpointId = e!.id

  savedRuns = await db.select().from(jobRuns)
  await db.delete(jobRuns)
})

beforeEach(async () => {
  if (deliveryIds.length > 0) {
    await db.delete(webhookDeliveries).where(inArray(webhookDeliveries.id, deliveryIds))
    deliveryIds.length = 0
  }
  await db.delete(jobRuns)
})

afterAll(async () => {
  if (deliveryIds.length > 0) {
    await db.delete(webhookDeliveries).where(inArray(webhookDeliveries.id, deliveryIds))
  }
  await db.delete(jobRuns)
  if (savedRuns.length > 0) await db.insert(jobRuns).values(savedRuns)

  if (endpointId) await db.delete(webhookEndpoints).where(eq(webhookEndpoints.id, endpointId))
  if (appId) await db.delete(apps).where(eq(apps.id, appId))
  if (businessId) await db.delete(businesses).where(eq(businesses.id, businessId))
  await pool.end()
})

describe('is anything running', () => {
  it('reports an instance that has never run as never run', async () => {
    /*
     * The failure with no symptoms of its own, and the one this instance was
     * actually in: pg-boss had never created its schema, so no worker had ever
     * started. Every other view looked healthy.
     */
    const health = await getSchedulerHealth()

    expect(health.neverRun).toBe(true)
    expect(health.lastRunAt).toBeNull()
    expect(health.quietForMinutes, 'never is not a duration').toBeNull()
    expect(health.silent).toBe(true)
    expect(schedulerNeedsAttention(health)).toBe(true)
  })

  it('calls a stamp from a moment ago healthy', async () => {
    await stampFresh()

    const health = await getSchedulerHealth()
    expect(health.neverRun).toBe(false)
    expect(health.silent).toBe(false)
    expect(health.quietForMinutes).toBe(0)
  })

  it('calls a stamp from an hour ago silent, but not never run', async () => {
    const then = minutesAgo(60)
    await recordJobRun({
      group: GROUP,
      startedAt: then,
      finishedAt: then,
      durationMs: 1,
      result: {},
    })

    const health = await getSchedulerHealth()
    expect(health.silent).toBe(true)
    expect(health.quietForMinutes).toBeGreaterThanOrEqual(59)
    // Stopped an hour ago and never started get different sentences, because
    // they get different first guesses from whoever reads them.
    expect(health.neverRun).toBe(false)
  })

  it('takes the most recent group, not the stalest', async () => {
    // A partial failure — say `webhooks` wedged while `sweep` ticks on — is not
    // the same as a dead scheduler, and must not be reported as one.
    const stale = minutesAgo(90)
    await recordJobRun({
      group: `${GROUP}-webhooks`,
      startedAt: stale,
      finishedAt: stale,
      durationMs: 1,
      result: {},
    })
    await stampFresh()

    const health = await getSchedulerHealth()
    expect(health.silent).toBe(false)
  })

  it('keeps one row per group rather than a history', async () => {
    const older = minutesAgo(120)
    await recordJobRun({
      group: GROUP,
      startedAt: older,
      finishedAt: older,
      durationMs: 1,
      result: {},
    })
    await stampFresh()

    const [row] = await db
      .select({ n: sql<string>`count(*)` })
      .from(jobRuns)
      .where(eq(jobRuns.group, GROUP))
    expect(row?.n, 'upserted, not appended').toBe('1')
  })

  it('records a run whose jobs all failed as a run', async () => {
    /*
     * The distinction the banner rests on. "Running and failing" needs somebody
     * to read the logs; "not running" needs somebody to start a process.
     * Reporting the first as the second sends them to the wrong place, so the
     * stamp is written even when every counter in it is zero.
     */
    await stampFresh()

    const health = await getSchedulerHealth()
    expect(health.silent).toBe(false)
  })
})

describe('is what it produces getting out', () => {
  beforeEach(stampFresh)

  it('counts an old unattempted delivery as a stuck backlog', async () => {
    const before = await getSchedulerHealth()
    await delivery({ ageMinutes: 120, attempts: 0, status: 'pending' })
    const after = await getSchedulerHealth()

    // Zero attempts on a row that is long past due can only mean nobody tried.
    // The sharpest signal available, and the exact shape the live instance was
    // in: twenty deliveries, all at attempts 0, for two days.
    expect(after.unattemptedDeliveries).toBe(before.unattemptedDeliveries + 1)
    expect(after.backlogStuck).toBe(true)
    expect(schedulerNeedsAttention(after)).toBe(true)
  })

  it('does not accuse a delivery that is waiting out its backoff', async () => {
    /*
     * The ladder runs 10s, 1m, 5m, 30m, 2h, 6h, 24h. A delivery part-way up it
     * has been tried and is queued for the future; counting it would make a
     * working retry look like a dead loop and teach operators to ignore the
     * banner.
     */
    const before = await getSchedulerHealth()
    await delivery({
      ageMinutes: 120,
      attempts: 3,
      status: 'pending',
      nextAttemptAt: new Date(Date.now() + 30 * 60_000),
    })
    const after = await getSchedulerHealth()

    expect(after.unattemptedDeliveries).toBe(before.unattemptedDeliveries)
    // Still visible as outstanding work, just not as a fault.
    expect(after.pendingDeliveries).toBe(before.pendingDeliveries + 1)
  })

  it('does not accuse a delivery that only just arrived', async () => {
    const before = await getSchedulerHealth()
    await delivery({ ageMinutes: 0, attempts: 0, status: 'pending' })
    const after = await getSchedulerHealth()

    expect(after.unattemptedDeliveries, 'a job has time to pick it up').toBe(
      before.unattemptedDeliveries,
    )
  })

  it('counts one that gave up separately from one nobody tried', async () => {
    const before = await getSchedulerHealth()
    await delivery({ ageMinutes: 300, attempts: 7, status: 'failed' })
    const after = await getSchedulerHealth()

    expect(after.failedDeliveries).toBe(before.failedDeliveries + 1)
    // Tried and rejected is the endpoint's problem, not the scheduler's.
    expect(after.unattemptedDeliveries).toBe(before.unattemptedDeliveries)
  })
})
