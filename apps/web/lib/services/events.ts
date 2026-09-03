import { randomUUID } from 'node:crypto'
import type { AccountEventData, PaymentEventData, WebhookEventType } from '@jomma/shared'
import { toPublicId } from '@jomma/shared'
import { and, arrayContains, eq } from 'drizzle-orm'
import type { Database, Tx } from '@/lib/db/client'
import { webhookDeliveries, webhookEndpoints } from '@/lib/db/schema'

/**
 * Queues an event for delivery.
 *
 * This only writes rows. The worker owns the HTTP call, the signature, and the
 * retry ladder — enqueueing inside the same transaction as the state change is
 * what makes "we said it arrived" and "we told the client" atomic.
 *
 * `event_id` is generated once and shared across every endpoint the app has
 * registered, so a receiver behind two URLs can still deduplicate.
 */
export async function queueEvent(
  tx: Database | Tx,
  options: {
    appId: string
    type: WebhookEventType
    data: PaymentEventData | AccountEventData
  },
): Promise<string | null> {
  const endpoints = await tx
    .select({ id: webhookEndpoints.id })
    .from(webhookEndpoints)
    .where(
      and(
        eq(webhookEndpoints.appId, options.appId),
        eq(webhookEndpoints.status, 'active'),
        arrayContains(webhookEndpoints.enabledEvents, [options.type]),
      ),
    )

  if (endpoints.length === 0) return null

  const eventId = toPublicId('event', randomUUID())
  const payload = {
    id: eventId,
    type: options.type,
    created_at: new Date().toISOString(),
    data: options.data,
  }

  await tx
    .insert(webhookDeliveries)
    .values(
      endpoints.map((endpoint) => ({
        endpointId: endpoint.id,
        appId: options.appId,
        eventId,
        eventType: options.type,
        payload,
        status: 'pending' as const,
        // Due immediately; the worker picks it up on its next poll.
        nextAttemptAt: new Date(),
      })),
    )
    .onConflictDoNothing()

  return eventId
}
