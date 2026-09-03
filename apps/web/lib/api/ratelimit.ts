/**
 * Rate limiting.
 *
 * Two mechanisms, deliberately:
 *
 * 1. This module — a fixed-window counter held in process memory. It covers the
 *    per-minute traffic limits in docs/api.md, which exist to protect the
 *    service from noise. Single-process only; a horizontally scaled deployment
 *    needs this moved into Postgres or Redis. Flagged, not hidden.
 *
 * 2. The per-intent submission limit (5/hour) is a *fraud* control, not a
 *    traffic control, so it is counted against `payment_submissions` in the
 *    database and survives a restart. See lib/services/submissions.ts.
 */

export interface RateLimitRule {
  limit: number
  windowSeconds: number
}

export const RATE_LIMITS = {
  'intents:create': { limit: 60, windowSeconds: 60 },
  'intents:get': { limit: 600, windowSeconds: 60 },
  'intents:mutate': { limit: 120, windowSeconds: 60 },
  'submissions:create': { limit: 20, windowSeconds: 60 },
  'accounts:list': { limit: 120, windowSeconds: 60 },
  'device:capture': { limit: 120, windowSeconds: 60 },
  'device:heartbeat': { limit: 20, windowSeconds: 60 },
  'device:events': { limit: 60, windowSeconds: 60 },
} as const satisfies Record<string, RateLimitRule>

export type RateLimitKey = keyof typeof RATE_LIMITS

export interface RateLimitResult {
  ok: boolean
  limit: number
  remaining: number
  /** Unix seconds when the current window rolls over. */
  reset: number
  retryAfter: number
}

interface Bucket {
  count: number
  resetAt: number
}

const buckets = new Map<string, Bucket>()
let lastSweep = 0

/** Keeps the map from growing without bound on a long-lived process. */
function sweep(now: number): void {
  if (now - lastSweep < 60_000) return
  lastSweep = now
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key)
  }
}

export function consume(rule: RateLimitKey, identifier: string): RateLimitResult {
  const { limit, windowSeconds } = RATE_LIMITS[rule]
  const now = Date.now()
  sweep(now)

  const key = `${rule}:${identifier}`
  let bucket = buckets.get(key)

  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + windowSeconds * 1000 }
    buckets.set(key, bucket)
  }

  bucket.count += 1

  const remaining = Math.max(0, limit - bucket.count)
  const reset = Math.ceil(bucket.resetAt / 1000)

  return {
    ok: bucket.count <= limit,
    limit,
    remaining,
    reset,
    retryAfter: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
  }
}

/** Test hook. */
export function resetRateLimits(): void {
  buckets.clear()
}
