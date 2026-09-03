import type { DeviceCommand } from '@jomma/shared'
import { relations } from 'drizzle-orm'
import { boolean, index, integer, jsonb, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core'
import { createdAt, fkId, poisha, primaryId, timestampTz, updatedAt } from './_shared'
import {
  accountStatusEnum,
  alertSeverityEnum,
  deviceStatusEnum,
  notifierEventKindEnum,
  providerEnum,
} from './enums'

/** A bKash or Nagad number Jomma watches. Two of these is the whole redundancy story. */
export const receivingAccounts = pgTable(
  'receiving_accounts',
  {
    id: primaryId(),
    provider: providerEnum('provider').notNull(),
    msisdn: text('msisdn').notNull(),
    label: text('label').notNull(),
    status: accountStatusEnum('status').notNull().default('active'),

    dailyLimitCents: poisha('daily_limit_cents').notNull().default(25_000_000),
    monthlyLimitCents: poisha('monthly_limit_cents').notNull().default(300_000_000),

    lastHeartbeatAt: timestampTz('last_heartbeat_at'),
    lastCaptureAt: timestampTz('last_capture_at'),

    /** Balance continuity: what the last message said the balance was, and when. */
    lastKnownBalanceCents: poisha('last_known_balance_cents'),
    balanceCheckedAt: timestampTz('balance_checked_at'),
    balanceDrift: boolean('balance_drift').notNull().default(false),
    balanceDriftCents: poisha('balance_drift_cents'),

    /** Why the account was degraded or disabled. Surfaced in the sidebar footer. */
    statusReason: text('status_reason'),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('ux_receiving_accounts_msisdn').on(table.msisdn),
    index('ix_receiving_accounts_status').on(table.status),
  ],
)

/**
 * A notifier device. Tokens are separate from API keys, scoped to one receiving
 * account, and revocable individually — a stolen phone must not cost a client
 * app its integration.
 */
export const devices = pgTable(
  'devices',
  {
    id: primaryId(),
    receivingAccountId: fkId('receiving_account_id')
      .notNull()
      .references(() => receivingAccounts.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    platform: text('platform').notNull().default('android'),

    tokenPrefix: text('token_prefix').notNull(),
    tokenHash: text('token_hash').notNull(),
    status: deviceStatusEnum('status').notNull().default('active'),

    appVersion: text('app_version'),
    lastHeartbeatAt: timestampTz('last_heartbeat_at'),
    lastCaptureAt: timestampTz('last_capture_at'),
    lastSeenIp: text('last_seen_ip'),

    battery: integer('battery'),
    charging: boolean('charging'),
    network: text('network'),
    queueDepth: integer('queue_depth'),
    permissions: jsonb('permissions').$type<Record<string, boolean>>(),

    /** Drained into the next heartbeat response. */
    pendingCommands: jsonb('pending_commands').notNull().default([]).$type<DeviceCommand[]>(),

    createdAt: createdAt(),
    revokedAt: timestampTz('revoked_at'),
  },
  (table) => [
    uniqueIndex('ux_devices_token_prefix').on(table.tokenPrefix),
    index('ix_devices_account').on(table.receivingAccountId, table.status),
  ],
)

/**
 * Device health and every alert-worthy thing that happens to an account.
 * Both device-reported events and server-derived ones (parse failure, balance
 * drift, heartbeat gap) land here so the dashboard has one timeline.
 */
export const notifierEvents = pgTable(
  'notifier_events',
  {
    id: primaryId(),
    receivingAccountId: fkId('receiving_account_id').references(() => receivingAccounts.id, {
      onDelete: 'cascade',
    }),
    deviceId: fkId('device_id').references(() => devices.id, {
      onDelete: 'set null',
    }),
    kind: notifierEventKindEnum('kind').notNull(),
    severity: alertSeverityEnum('severity').notNull().default('low'),
    detail: text('detail'),
    payload: jsonb('payload').notNull().default({}).$type<Record<string, unknown>>(),
    acknowledgedAt: timestampTz('acknowledged_at'),
    acknowledgedBy: fkId('acknowledged_by'),
    createdAt: createdAt(),
  },
  (table) => [
    index('ix_notifier_events_recent').on(table.createdAt),
    index('ix_notifier_events_kind').on(table.kind, table.createdAt),
    index('ix_notifier_events_account').on(table.receivingAccountId, table.createdAt),
    // The alerts panel: unacknowledged, worst first.
    index('ix_notifier_events_open').on(table.acknowledgedAt, table.severity),
  ],
)

export const receivingAccountsRelations = relations(receivingAccounts, ({ many }) => ({
  devices: many(devices),
  events: many(notifierEvents),
}))

export const devicesRelations = relations(devices, ({ one }) => ({
  account: one(receivingAccounts, {
    fields: [devices.receivingAccountId],
    references: [receivingAccounts.id],
  }),
}))

export const notifierEventsRelations = relations(notifierEvents, ({ one }) => ({
  account: one(receivingAccounts, {
    fields: [notifierEvents.receivingAccountId],
    references: [receivingAccounts.id],
  }),
  device: one(devices, {
    fields: [notifierEvents.deviceId],
    references: [devices.id],
  }),
}))
