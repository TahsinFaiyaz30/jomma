import 'server-only'

import { sql } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { jobRuns, webhookDeliveries } from '@/lib/db/schema'

/**
 * Is anything actually running?
 *
 * Every other detector in this codebase is a scheduled job: heartbeat gaps,
 * capture silence, parse failures, stuck deliveries. That is the right place for
 * them and it leaves exactly one blind spot, which is the scheduler itself. When
 * it stops, the alerts stop with it, and what reaches an operator is a set of
 * symptoms that all point somewhere else — a shop's stock never released, an
 * intent still `open` a day past its deadline, a webhook that "never arrived".
 *
 * This module is the detector for that, and the whole point of it is *where it
 * runs*: on the dashboard's render path, which does not need the scheduler to be
 * alive in order to notice that it is not.
 *
 * Two questions, deliberately separate:
 *
 *  - **Is the scheduler running at all?** `job_runs` is stamped by `runJobs`, so
 *    a stale or absent row means nothing has swept, delivered or alerted since
 *    then. Absent is the worse case and is called out as such: a deployment
 *    where the worker was never started looks healthy in every other view.
 *  - **Is delivery getting through?** The backlog can be stuck with a perfectly
 *    live scheduler — an endpoint registered against the wrong port answers
 *    nothing, and attempts climb while deliveries never land. Counting
 *    unattempted rows separately is what tells those two apart, because
 *    `attempts = 0` on an old row can only mean nobody tried.
 */

/**
 * How long the scheduler may be quiet before the dashboard says so.
 *
 * The tightest cadence is a minute (`webhooks`, `sweep`), so anything past a few
 * of those is not a slow tick. Ten minutes is late enough to survive a restart,
 * a deploy or a laptop asleep between two cron pings, and early enough that
 * nobody spends an afternoon wondering why a payment never confirmed.
 */
const SILENT_AFTER_MINUTES = 10

/**
 * How long a delivery may sit before the backlog counts as stuck.
 *
 * Generous, because the retry ladder is deliberately long — 10s, 1m, 5m, 30m,
 * 2h, 6h, 24h — and a delivery legitimately waiting out its sixth backoff is
 * not a fault. What this is looking for is the shape that ladder never
 * produces: rows piling up that nothing is working through.
 */
const BACKLOG_STUCK_AFTER_MINUTES = 30

export interface SchedulerHealth {
  /** The most recent run of any group, or null if none has ever run. */
  lastRunAt: string | null
  /** Null when nothing has ever run — which is not the same as "a long time". */
  quietForMinutes: number | null
  /**
   * No group has ever stamped a row.
   *
   * Called out separately because it is the failure with no symptoms of its
   * own. A worker that died last Tuesday at least has a last-seen time; one
   * that was never started looks exactly like a brand-new deployment.
   */
  neverRun: boolean
  /** True once the quiet has gone past the point of being a slow tick. */
  silent: boolean

  pendingDeliveries: number
  /**
   * Pending, past due, and never once attempted.
   *
   * The sharpest signal here. A delivery that has failed seven times has been
   * tried and the endpoint is the problem; a delivery sitting at zero attempts
   * means the loop that would have tried it is not running.
   */
  unattemptedDeliveries: number
  failedDeliveries: number
  oldestPendingAt: string | null
  /** Deliveries are queueing up and nothing is working through them. */
  backlogStuck: boolean
}

export async function getSchedulerHealth(): Promise<SchedulerHealth> {
  const staleBefore = new Date(Date.now() - BACKLOG_STUCK_AFTER_MINUTES * 60_000)

  const [runs, deliveries] = await Promise.all([
    db
      .select({ finishedAt: sql<Date | null>`max(${jobRuns.finishedAt})` })
      .from(jobRuns)
      .then((rows) => rows[0]?.finishedAt ?? null),

    db
      .select({
        pending: sql<string>`count(*) filter (where ${webhookDeliveries.status} in ('pending','delivering'))`,
        failed: sql<string>`count(*) filter (where ${webhookDeliveries.status} = 'failed')`,
        /*
         * Only rows that are actually due. A delivery scheduled for its next
         * backoff has not been skipped, it is waiting, and counting it here
         * would make a healthy retry ladder look like a dead loop.
         */
        unattempted: sql<string>`count(*) filter (
          where ${webhookDeliveries.status} = 'pending'
            and ${webhookDeliveries.attempts} = 0
            and coalesce(${webhookDeliveries.nextAttemptAt}, ${webhookDeliveries.createdAt}) <= ${staleBefore.toISOString()}
        )`,
        oldestPending: sql<Date | null>`min(${webhookDeliveries.createdAt}) filter (where ${webhookDeliveries.status} in ('pending','delivering'))`,
      })
      .from(webhookDeliveries)
      .then((rows) => rows[0]),
  ])

  const lastRunAt = runs ? new Date(runs) : null
  const quietForMinutes = lastRunAt ? Math.floor((Date.now() - lastRunAt.getTime()) / 60_000) : null

  const unattempted = Number(deliveries?.unattempted ?? 0)
  const oldestPending = deliveries?.oldestPending ? new Date(deliveries.oldestPending) : null

  return {
    lastRunAt: lastRunAt?.toISOString() ?? null,
    quietForMinutes,
    neverRun: lastRunAt === null,
    silent: lastRunAt === null || (quietForMinutes ?? 0) >= SILENT_AFTER_MINUTES,
    pendingDeliveries: Number(deliveries?.pending ?? 0),
    unattemptedDeliveries: unattempted,
    failedDeliveries: Number(deliveries?.failed ?? 0),
    oldestPendingAt: oldestPending?.toISOString() ?? null,
    backlogStuck: unattempted > 0,
  }
}

/**
 * Whether this is worth interrupting an operator over.
 *
 * Kept beside the reader rather than in the component, so the banner and the
 * scheduled alert cannot drift into disagreeing about what "broken" means.
 */
export function schedulerNeedsAttention(health: SchedulerHealth): boolean {
  return health.silent || health.backlogStuck
}

/**
 * Stamped by `runJobs` at the end of every group.
 *
 * Deliberately outside the `attempt` wrapper's failure handling: a group that
 * threw still ran, and recording that it ran is what stops the dashboard
 * reporting a dead scheduler for a live one that is merely failing. What went
 * wrong is already in the logs and in `last_result`.
 */
export async function recordJobRun(options: {
  group: string
  startedAt: Date
  finishedAt: Date
  durationMs: number
  result: Record<string, unknown>
}): Promise<void> {
  await db
    .insert(jobRuns)
    .values({
      group: options.group,
      startedAt: options.startedAt,
      finishedAt: options.finishedAt,
      durationMs: options.durationMs,
      lastResult: options.result,
    })
    .onConflictDoUpdate({
      target: jobRuns.group,
      set: {
        startedAt: options.startedAt,
        finishedAt: options.finishedAt,
        durationMs: options.durationMs,
        lastResult: options.result,
      },
    })
}

/** Per-group detail for the operator who wants to know *which* half is dead. */
export async function listJobRuns(): Promise<
  Array<{ group: string; finishedAt: string; durationMs: number }>
> {
  const rows = await db
    .select({
      group: jobRuns.group,
      finishedAt: jobRuns.finishedAt,
      durationMs: jobRuns.durationMs,
    })
    .from(jobRuns)
    .orderBy(jobRuns.group)

  return rows.map((row) => ({
    group: row.group,
    finishedAt: row.finishedAt.toISOString(),
    durationMs: row.durationMs,
  }))
}

/** Exported for the health job, so both paths agree on the thresholds. */
export const SCHEDULER_THRESHOLDS = {
  silentAfterMinutes: SILENT_AFTER_MINUTES,
  backlogStuckAfterMinutes: BACKLOG_STUCK_AFTER_MINUTES,
} as const
