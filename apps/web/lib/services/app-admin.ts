import 'server-only'

import { randomBytes } from 'node:crypto'
import type { WebhookEventType } from '@jomma/shared'
import { WEBHOOK_EVENT_TYPES } from '@jomma/shared'
import { and, desc, eq, sql } from 'drizzle-orm'
import { generateApiKey } from '@/lib/auth/tokens'
import { db } from '@/lib/db/client'
import { apiKeys, apps, webhookDeliveries, webhookEndpoints } from '@/lib/db/schema'
import { audit } from './audit'

/** Apps, their credentials, and their webhook plumbing. */

export interface AppView {
  id: string
  name: string
  slug: string
  status: string
  keys: Array<{
    id: string
    name: string
    environment: string
    prefix: string
    lastFour: string
    status: string
    lastUsedAt: string | null
    createdAt: string
  }>
  endpoints: Array<{
    id: string
    url: string
    description: string | null
    status: string
    enabledEvents: string[]
    createdAt: string
  }>
  deliveries: Array<{
    id: string
    eventId: string
    eventType: string
    status: string
    attempts: number
    lastStatusCode: number | null
    lastError: string | null
    nextAttemptAt: string | null
    deliveredAt: string | null
    createdAt: string
    url: string
  }>
  deliveryCounts: { pending: number; delivered: number; failed: number }
}

export async function listApps(): Promise<AppView[]> {
  const rows = await db.select().from(apps).orderBy(apps.name)

  return Promise.all(
    rows.map(async (app) => {
      const keys = await db
        .select()
        .from(apiKeys)
        .where(eq(apiKeys.appId, app.id))
        .orderBy(desc(apiKeys.createdAt))

      const endpoints = await db
        .select()
        .from(webhookEndpoints)
        .where(eq(webhookEndpoints.appId, app.id))
        .orderBy(desc(webhookEndpoints.createdAt))

      const deliveries = await db
        .select({
          delivery: webhookDeliveries,
          url: webhookEndpoints.url,
        })
        .from(webhookDeliveries)
        .innerJoin(webhookEndpoints, eq(webhookDeliveries.endpointId, webhookEndpoints.id))
        .where(eq(webhookDeliveries.appId, app.id))
        .orderBy(desc(webhookDeliveries.createdAt))
        .limit(50)

      const [counts] = await db
        .select({
          pending: sql<string>`count(*) filter (where status in ('pending','delivering'))`,
          delivered: sql<string>`count(*) filter (where status = 'delivered')`,
          failed: sql<string>`count(*) filter (where status = 'failed')`,
        })
        .from(webhookDeliveries)
        .where(eq(webhookDeliveries.appId, app.id))

      return {
        id: app.id,
        name: app.name,
        slug: app.slug,
        status: app.status,
        keys: keys.map((key) => ({
          id: key.id,
          name: key.name,
          environment: key.environment,
          prefix: key.prefix,
          lastFour: key.lastFour,
          status: key.status,
          lastUsedAt: key.lastUsedAt?.toISOString() ?? null,
          createdAt: key.createdAt.toISOString(),
        })),
        endpoints: endpoints.map((endpoint) => ({
          id: endpoint.id,
          url: endpoint.url,
          description: endpoint.description,
          status: endpoint.status,
          enabledEvents: endpoint.enabledEvents,
          createdAt: endpoint.createdAt.toISOString(),
        })),
        deliveries: deliveries.map(({ delivery, url }) => ({
          id: delivery.id,
          eventId: delivery.eventId,
          eventType: delivery.eventType,
          status: delivery.status,
          attempts: delivery.attempts,
          lastStatusCode: delivery.lastStatusCode,
          lastError: delivery.lastError,
          nextAttemptAt: delivery.nextAttemptAt?.toISOString() ?? null,
          deliveredAt: delivery.deliveredAt?.toISOString() ?? null,
          createdAt: delivery.createdAt.toISOString(),
          url,
        })),
        deliveryCounts: {
          pending: Number(counts?.pending ?? 0),
          delivered: Number(counts?.delivered ?? 0),
          failed: Number(counts?.failed ?? 0),
        },
      }
    }),
  )
}

/**
 * Mints a key. The plaintext is returned here and never stored — this is the one
 * moment it exists outside the caller's clipboard.
 */
export async function createApiKey(options: {
  appId: string
  name: string
  environment: 'live' | 'test'
  actorId: string
}): Promise<{ plaintext: string }> {
  const key = await generateApiKey(options.environment)

  await db.transaction(async (tx) => {
    await tx.insert(apiKeys).values({
      appId: options.appId,
      name: options.name,
      environment: options.environment,
      prefix: key.prefix,
      lastFour: key.lastFour,
      keyHash: key.hash,
    })

    await audit(tx, {
      action: 'apikey.created',
      actorId: options.actorId,
      actorType: 'admin',
      appId: options.appId,
      payload: { name: options.name, prefix: key.prefix, environment: options.environment },
    })
  })

  return { plaintext: key.plaintext }
}

export async function revokeApiKey(options: { keyId: string; actorId: string }): Promise<void> {
  await db
    .update(apiKeys)
    .set({ status: 'revoked', revokedAt: new Date() })
    .where(eq(apiKeys.id, options.keyId))
}

export async function createWebhookEndpoint(options: {
  appId: string
  url: string
  description?: string
}): Promise<{ secret: string }> {
  const secret = `whsec_${randomBytes(24).toString('hex')}`

  await db
    .insert(webhookEndpoints)
    .values({
      appId: options.appId,
      url: options.url,
      description: options.description ?? null,
      secret,
      // Everything by default. Narrowing is a deliberate act; silently missing
      // payment.succeeded because a checkbox defaulted off is not.
      enabledEvents: [...WEBHOOK_EVENT_TYPES] as WebhookEventType[],
    })
    .onConflictDoUpdate({
      target: [webhookEndpoints.appId, webhookEndpoints.url],
      set: { secret, status: 'active', description: options.description ?? null },
    })

  return { secret }
}

export async function setEndpointStatus(options: {
  endpointId: string
  status: 'active' | 'disabled'
}): Promise<void> {
  await db
    .update(webhookEndpoints)
    .set({ status: options.status })
    .where(eq(webhookEndpoints.id, options.endpointId))
}

/**
 * Manual replay of a failed delivery.
 *
 * Resets the ladder rather than continuing it: a replay is a deliberate act,
 * not attempt eight. The worker picks it up on its next poll.
 */
export async function replayDelivery(options: {
  deliveryId: string
  actorId: string
}): Promise<void> {
  const [updated] = await db
    .update(webhookDeliveries)
    .set({ status: 'pending', attempts: 0, nextAttemptAt: new Date(), lastError: null })
    .where(eq(webhookDeliveries.id, options.deliveryId))
    .returning({ id: webhookDeliveries.id, appId: webhookDeliveries.appId })

  if (!updated) throw new Error('Unknown delivery')

  await db.transaction(async (tx) => {
    await audit(tx, {
      action: 'webhook.replayed',
      actorId: options.actorId,
      actorType: 'admin',
      appId: updated.appId,
      payload: { delivery_id: options.deliveryId },
    })
  })
}

/** Replays every failed delivery for an app in one go. */
export async function replayAllFailed(options: {
  appId: string
  actorId: string
}): Promise<number> {
  const rows = await db
    .update(webhookDeliveries)
    .set({ status: 'pending', attempts: 0, nextAttemptAt: new Date(), lastError: null })
    .where(and(eq(webhookDeliveries.appId, options.appId), eq(webhookDeliveries.status, 'failed')))
    .returning({ id: webhookDeliveries.id })

  return rows.length
}
