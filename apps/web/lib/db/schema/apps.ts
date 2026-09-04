import type { WebhookEventType } from '@jomma/shared'
import { relations } from 'drizzle-orm'
import { index, integer, jsonb, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core'
import { createdAt, fkId, primaryId, timestampTz, updatedAt } from './_shared'
import {
  appStatusEnum,
  deliveryStatusEnum,
  idempotencyStatusEnum,
  keyEnvironmentEnum,
  webhookEventTypeEnum,
} from './enums'

/** A tenant. One Jomma instance serves several client apps, keyed by API key. */
export const apps = pgTable(
  'apps',
  {
    id: primaryId(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    status: appStatusEnum('status').notNull().default('active'),

    /**
     * Hostnames this app may send a buyer back to from the hosted pay page.
     *
     * An unchecked `return_url` is an open redirect on a page the buyer has
     * already been told to trust with a payment, which is the worst place to
     * have one. Empty means the app cannot use hosted redirect at all — the pay
     * page still works, it just has nowhere to send them afterwards. Fail
     * closed: a store that has not registered its domain does not get a
     * redirect, rather than getting any redirect it asks for.
     */
    allowedRedirectHosts: jsonb('allowed_redirect_hosts').notNull().default([]).$type<string[]>(),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [uniqueIndex('ux_apps_slug').on(table.slug)],
)

/**
 * Argon2 at rest, same as a password. The plaintext is shown once at creation
 * and never again.
 *
 * `prefix` is the first 16 characters of the token (`jm_live_` plus 8 public
 * characters) and is stored in clear. Without it, authenticating a request would
 * mean an Argon2 verification against every key in the table.
 */
export const apiKeys = pgTable(
  'api_keys',
  {
    id: primaryId(),
    appId: fkId('app_id')
      .notNull()
      .references(() => apps.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    environment: keyEnvironmentEnum('environment').notNull().default('live'),
    prefix: text('prefix').notNull(),
    lastFour: text('last_four').notNull(),
    keyHash: text('key_hash').notNull(),
    status: text('status').notNull().default('active'),
    lastUsedAt: timestampTz('last_used_at'),
    revokedAt: timestampTz('revoked_at'),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('ux_api_keys_prefix').on(table.prefix),
    index('ix_api_keys_app').on(table.appId, table.status),
  ],
)

export const webhookEndpoints = pgTable(
  'webhook_endpoints',
  {
    id: primaryId(),
    appId: fkId('app_id')
      .notNull()
      .references(() => apps.id, { onDelete: 'cascade' }),
    url: text('url').notNull(),
    description: text('description'),
    /**
     * Used to sign outgoing deliveries, so it has to be recoverable — it cannot
     * be hashed. Treat the column as a secret: never select it into a response,
     * never log it. Encrypting at rest with a KMS key is the obvious hardening
     * once a deployment target is settled.
     */
    secret: text('secret').notNull(),
    enabledEvents: webhookEventTypeEnum('enabled_events')
      .array()
      .notNull()
      .$type<WebhookEventType[]>(),
    status: text('status').notNull().default('active'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index('ix_webhook_endpoints_app').on(table.appId, table.status),
    // Registering the same URL twice for one app is always a mistake, and it is
    // an expensive one: every event is then delivered twice, and a receiver that
    // deduplicates on event_id sees the second copy as a replay rather than a
    // bug.
    uniqueIndex('ux_webhook_endpoints_app_url').on(table.appId, table.url),
  ],
)

/**
 * At-least-once delivery. `eventId` is stable across every retry so a receiver
 * can deduplicate, and it is what the dashboard replays by.
 */
export const webhookDeliveries = pgTable(
  'webhook_deliveries',
  {
    id: primaryId(),
    endpointId: fkId('endpoint_id')
      .notNull()
      .references(() => webhookEndpoints.id, { onDelete: 'cascade' }),
    appId: fkId('app_id')
      .notNull()
      .references(() => apps.id, { onDelete: 'cascade' }),
    eventId: text('event_id').notNull(),
    eventType: webhookEventTypeEnum('event_type').notNull(),
    payload: jsonb('payload').notNull().$type<Record<string, unknown>>(),
    status: deliveryStatusEnum('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: timestampTz('next_attempt_at'),
    lastAttemptAt: timestampTz('last_attempt_at'),
    lastStatusCode: integer('last_status_code'),
    lastError: text('last_error'),
    deliveredAt: timestampTz('delivered_at'),
    createdAt: createdAt(),
  },
  (table) => [
    // One delivery row per (endpoint, event). Re-enqueuing the same event is a
    // no-op rather than a second HTTP call.
    uniqueIndex('ux_webhook_deliveries_endpoint_event').on(table.endpointId, table.eventId),
    // The worker's claim query.
    index('ix_webhook_deliveries_due').on(table.status, table.nextAttemptAt),
    index('ix_webhook_deliveries_app').on(table.appId, table.createdAt),
  ],
)

/**
 * `Idempotency-Key` on POST /v1/intents. Replaying a key within 24h returns the
 * original intent rather than allocating a second reference code.
 *
 * A separate table rather than a column on payment_intents: the key has to
 * expire so the same key can be reused after the window, and a partial unique
 * index cannot reference `now()`.
 */
export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    id: primaryId(),
    appId: fkId('app_id')
      .notNull()
      .references(() => apps.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    endpoint: text('endpoint').notNull(),
    /** Guards against the same key being replayed with a different body. */
    requestHash: text('request_hash').notNull(),
    status: idempotencyStatusEnum('status').notNull().default('in_progress'),
    responseStatus: integer('response_status'),
    responseBody: jsonb('response_body').$type<Record<string, unknown>>(),
    expiresAt: timestampTz('expires_at').notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('ux_idempotency_app_key').on(table.appId, table.key),
    index('ix_idempotency_expiry').on(table.expiresAt),
  ],
)

export const appsRelations = relations(apps, ({ many }) => ({
  apiKeys: many(apiKeys),
  webhookEndpoints: many(webhookEndpoints),
}))

export const apiKeysRelations = relations(apiKeys, ({ one }) => ({
  app: one(apps, { fields: [apiKeys.appId], references: [apps.id] }),
}))

export const webhookEndpointsRelations = relations(webhookEndpoints, ({ one, many }) => ({
  app: one(apps, { fields: [webhookEndpoints.appId], references: [apps.id] }),
  deliveries: many(webhookDeliveries),
}))

export const webhookDeliveriesRelations = relations(webhookDeliveries, ({ one }) => ({
  endpoint: one(webhookEndpoints, {
    fields: [webhookDeliveries.endpointId],
    references: [webhookEndpoints.id],
  }),
}))
