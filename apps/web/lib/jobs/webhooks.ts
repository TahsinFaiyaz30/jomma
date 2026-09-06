import { createHmac } from 'node:crypto'
import {
  EVENT_ID_HEADER,
  EVENT_TYPE_HEADER,
  formatSignatureHeader,
  SIGNATURE_HEADER,
  signingPayload,
  WEBHOOK_MAX_ATTEMPTS,
  WEBHOOK_RETRY_DELAYS_SECONDS,
} from '@jomma/shared'
import { env } from '@jomma/shared/env'
import { and, eq, isNull, lte, or, sql } from 'drizzle-orm'
import { db, schema } from '@/lib/db/client'
import { logger } from '@/lib/logger'
import { assertDeliverableUrl, WebhookTargetError } from '@/lib/services/webhook-targets'

const { webhookDeliveries, webhookEndpoints } = schema

/**
 * Webhook delivery.
 *
 * At-least-once. The same `event_id` may arrive twice and receivers must be
 * idempotent — which is why the id is stable across every attempt rather than
 * regenerated per retry.
 *
 * Retries at 10s, 1m, 5m, 30m, 2h, 6h, 24h. After the final attempt the delivery
 * is marked `failed` and surfaced in the dashboard for manual replay. It is never
 * silently dropped: a client that missed a `payment.succeeded` has an order sitting
 * unfulfilled, and nobody finds that by reading logs.
 */

const BATCH_SIZE = 25

export async function deliverDueWebhooks(): Promise<{
  attempted: number
  delivered: number
}> {
  const now = new Date()

  /*
   * Claim a batch atomically. `for update skip locked` means two worker
   * processes can run this concurrently without ever sending the same delivery
   * twice — the second one simply skips the rows the first is holding.
   */
  const claimed = await db.execute<{ id: string }>(sql`
    update ${webhookDeliveries}
       set status = 'delivering', last_attempt_at = ${now.toISOString()}
     where id in (
       select id from ${webhookDeliveries}
        where status = 'pending'
          and (next_attempt_at is null or next_attempt_at <= ${now.toISOString()})
        order by next_attempt_at asc nulls first
        limit ${BATCH_SIZE}
        for update skip locked
     )
    returning id
  `)

  const ids = claimed.rows.map((row) => row.id)
  if (ids.length === 0) return { attempted: 0, delivered: 0 }

  let delivered = 0

  for (const id of ids) {
    const row = await db
      .select({
        delivery: webhookDeliveries,
        url: webhookEndpoints.url,
        secret: webhookEndpoints.secret,
        endpointStatus: webhookEndpoints.status,
      })
      .from(webhookDeliveries)
      .innerJoin(webhookEndpoints, eq(webhookDeliveries.endpointId, webhookEndpoints.id))
      .where(eq(webhookDeliveries.id, id))
      .limit(1)
      .then((rows) => rows[0])

    if (!row) continue

    if (row.endpointStatus !== 'active') {
      await db
        .update(webhookDeliveries)
        .set({ status: 'failed', lastError: 'Endpoint is disabled' })
        .where(eq(webhookDeliveries.id, id))
      continue
    }

    /*
     * Check the destination again here, not only where it was registered.
     *
     * Registration is one moment; this runs every time. A hostname that pointed
     * somewhere public when it was saved can point at the private network by
     * the time an event fires, and rows created before that check existed have
     * never been looked at once. Failed outright rather than retried — the
     * ladder cannot make an address allowed.
     */
    try {
      await assertDeliverableUrl(row.url)
    } catch (error) {
      await db
        .update(webhookDeliveries)
        .set({
          status: 'failed',
          lastError:
            error instanceof WebhookTargetError ? error.message : 'Endpoint URL is not usable',
          nextAttemptAt: null,
        })
        .where(eq(webhookDeliveries.id, id))
      logger.warn({ deliveryId: id, endpointId: row.delivery.endpointId }, 'webhook target refused')
      continue
    }

    const ok = await attemptDelivery({
      id,
      url: row.url,
      secret: row.secret,
      payload: row.delivery.payload,
      eventId: row.delivery.eventId,
      eventType: row.delivery.eventType,
      attempts: row.delivery.attempts,
    })

    if (ok) delivered += 1
  }

  return { attempted: ids.length, delivered }
}

async function attemptDelivery(options: {
  id: string
  url: string
  secret: string
  payload: unknown
  eventId: string
  eventType: string
  attempts: number
}): Promise<boolean> {
  const attempt = options.attempts + 1
  // Serialise once. The signature covers these exact bytes, so re-stringifying
  // for the body would risk a different key order and a signature the receiver
  // cannot verify.
  const body = JSON.stringify(options.payload)
  const timestamp = Math.floor(Date.now() / 1000)
  const signature = createHmac('sha256', options.secret)
    .update(signingPayload(timestamp, body))
    .digest('hex')

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), env().WEBHOOK_TIMEOUT_MS)

  let statusCode: number | null = null
  let error: string | null = null

  try {
    const response = await fetch(options.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'user-agent': 'Jomma/0.1',
        [SIGNATURE_HEADER]: formatSignatureHeader(timestamp, signature),
        [EVENT_ID_HEADER]: options.eventId,
        [EVENT_TYPE_HEADER]: options.eventType,
      },
      body,
      signal: controller.signal,
      redirect: 'error',
    })
    statusCode = response.status
    if (!response.ok) {
      error = `HTTP ${response.status}`
    }
  } catch (caught) {
    error = caught instanceof Error ? caught.message : 'Request failed'
  } finally {
    clearTimeout(timeout)
  }

  if (error === null) {
    await db
      .update(webhookDeliveries)
      .set({
        status: 'delivered',
        attempts: attempt,
        lastStatusCode: statusCode,
        lastError: null,
        deliveredAt: new Date(),
        nextAttemptAt: null,
      })
      .where(eq(webhookDeliveries.id, options.id))

    logger.info({ eventId: options.eventId, attempt, statusCode }, 'webhook delivered')
    return true
  }

  const exhausted = attempt >= WEBHOOK_MAX_ATTEMPTS
  const delaySeconds = WEBHOOK_RETRY_DELAYS_SECONDS[attempt - 1]

  await db
    .update(webhookDeliveries)
    .set({
      status: exhausted ? 'failed' : 'pending',
      attempts: attempt,
      lastStatusCode: statusCode,
      lastError: error,
      nextAttemptAt: exhausted ? null : new Date(Date.now() + (delaySeconds ?? 3600) * 1000),
    })
    .where(eq(webhookDeliveries.id, options.id))

  logger[exhausted ? 'error' : 'warn'](
    { eventId: options.eventId, attempt, statusCode, error, exhausted },
    exhausted ? 'webhook exhausted — needs manual replay' : 'webhook attempt failed',
  )

  return false
}

/**
 * Requeues a delivery from the dashboard. Resets the ladder rather than
 * continuing it — a manual replay is a deliberate act, not attempt eight.
 */
export async function replayDelivery(deliveryId: string): Promise<void> {
  await db
    .update(webhookDeliveries)
    .set({
      status: 'pending',
      attempts: 0,
      nextAttemptAt: new Date(),
      lastError: null,
    })
    .where(eq(webhookDeliveries.id, deliveryId))
}

/** Deliveries stuck in `delivering` because a worker died mid-attempt. */
export async function requeueStuckDeliveries(olderThanMinutes = 10): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanMinutes * 60_000)

  const result = await db
    .update(webhookDeliveries)
    .set({ status: 'pending', nextAttemptAt: new Date() })
    .where(
      and(
        eq(webhookDeliveries.status, 'delivering'),
        or(isNull(webhookDeliveries.lastAttemptAt), lte(webhookDeliveries.lastAttemptAt, cutoff)),
      ),
    )
    .returning({ id: webhookDeliveries.id })

  if (result.length > 0) {
    logger.warn({ count: result.length }, 'requeued deliveries left in-flight by a dead worker')
  }
  return result.length
}
