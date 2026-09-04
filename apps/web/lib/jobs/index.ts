import { logger } from '@/lib/logger'
import { expireDueIntents } from '@/lib/services/intents'
import { retryOrphans } from '@/lib/services/match-runner'
import {
  checkCaptureSilence,
  checkHeartbeatGaps,
  checkParseFailures,
  pruneIdempotencyKeys,
} from './health'
import { deliverDueWebhooks, requeueStuckDeliveries } from './webhooks'

/**
 * Everything that has to happen on a timer.
 *
 * The work lives here; scheduling lives somewhere else. `apps/worker` runs these
 * on pg-boss cadences, and a hosted deployment with no persistent process gets
 * the same behaviour from a cron service POSTing to `/api/internal/sweep`. Those
 * two are not approximations of each other — they call this same function.
 *
 * Groups exist because the cadences genuinely differ: webhook retries want to be
 * checked every minute, expiry every thirty seconds, health every five minutes,
 * and maintenance hourly. A host that can only manage one cron entry can call
 * `all` on the tightest of those and be correct, just noisier.
 */

export const JOB_GROUPS = ['sweep', 'webhooks', 'health', 'maintenance', 'all'] as const
export type JobGroup = (typeof JOB_GROUPS)[number]

export interface JobRunResult {
  group: JobGroup
  ms: number
  /** Only the counters for the groups that actually ran. */
  expired?: number
  rematched?: number
  webhooksAttempted?: number
  webhooksDelivered?: number
  webhooksRequeued?: number
  heartbeatGaps?: number
  captureSilence?: number
  parseFailures?: number
  idempotencyPruned?: number
}

/**
 * Never throws.
 *
 * A failing health check must not stop webhook delivery, and neither must stop
 * the caller from getting a 200 — a cron service that sees a 500 will retry the
 * whole batch, which is how one broken query turns into a thundering herd
 * against the database.
 */
async function attempt<T>(label: string, run: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await run()
  } catch (error) {
    logger.error({ err: error, job: label }, 'scheduled job failed')
    return fallback
  }
}

export async function runJobs(group: JobGroup = 'all'): Promise<JobRunResult> {
  const startedAt = Date.now()
  const result: JobRunResult = { group, ms: 0 }

  const wants = (name: Exclude<JobGroup, 'all'>) => group === 'all' || group === name

  /*
   * Expiry and orphan re-matching are money decisions — expiry emits
   * `payment.expired` and releases a lock, and a retry can approve a payment —
   * so they go through the same service functions the API uses.
   */
  if (wants('sweep')) {
    const [expired, rematched] = await Promise.all([
      attempt('expireDueIntents', expireDueIntents, 0),
      attempt('retryOrphans', retryOrphans, 0),
    ])
    Object.assign(result, { expired, rematched })
  }

  if (wants('webhooks')) {
    const delivery = await attempt('deliverDueWebhooks', deliverDueWebhooks, {
      attempted: 0,
      delivered: 0,
    })
    result.webhooksAttempted = delivery.attempted
    result.webhooksDelivered = delivery.delivered
  }

  if (wants('health')) {
    const [heartbeatGaps, captureSilence, parseFailures] = await Promise.all([
      attempt('checkHeartbeatGaps', checkHeartbeatGaps, 0),
      attempt('checkCaptureSilence', checkCaptureSilence, 0),
      attempt('checkParseFailures', checkParseFailures, 0),
    ])
    Object.assign(result, { heartbeatGaps, captureSilence, parseFailures })
  }

  if (wants('maintenance')) {
    const [idempotencyPruned, webhooksRequeued] = await Promise.all([
      attempt('pruneIdempotencyKeys', pruneIdempotencyKeys, 0),
      attempt('requeueStuckDeliveries', () => requeueStuckDeliveries(), 0),
    ])
    Object.assign(result, { idempotencyPruned, webhooksRequeued })
  }

  result.ms = Date.now() - startedAt
  return result
}

export function isJobGroup(value: string | null): value is JobGroup {
  return value !== null && (JOB_GROUPS as readonly string[]).includes(value)
}

export {
  checkCaptureSilence,
  checkHeartbeatGaps,
  checkParseFailures,
  pruneIdempotencyKeys,
} from './health'
// `replayDelivery` is deliberately not re-exported: `lib/services/app-admin.ts`
// exports an admin-facing function of the same name, and having both reachable
// from one barrel is how the wrong one gets imported.
export { deliverDueWebhooks, requeueStuckDeliveries } from './webhooks'
