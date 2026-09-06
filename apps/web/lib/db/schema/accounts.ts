import type { DeviceCommand } from '@jomma/shared'
import { relations, sql } from 'drizzle-orm'
import { boolean, index, integer, jsonb, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core'
import { createdAt, fkId, poisha, primaryId, timestampTz, updatedAt } from './_shared'
import { businesses } from './businesses'
import {
  accountStatusEnum,
  alertSeverityEnum,
  deviceStatusEnum,
  notifierEventKindEnum,
  providerEnum,
} from './enums'

/**
 * A bKash or Nagad number Jomma watches. Two of these is the whole redundancy
 * story — for one merchant. Across merchants they never mix: routing only ever
 * considers the numbers belonging to the business whose intent is being paid,
 * which is what stops one shop's payment being directed at another's phone.
 */
export const receivingAccounts = pgTable(
  'receiving_accounts',
  {
    id: primaryId(),

    /** Whose number this is. The tenant boundary for everything captured on it. */
    businessId: fkId('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),

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

    /*
     * What to keep from this number's message stream.
     *
     * The phone forwards everything its provider app emits, which for bKash is
     * promotions, balance notices, cash-in confirmations and the one message
     * type that can actually settle an order. Storing all of it buries the feed
     * in noise nobody reads.
     *
     * Incoming Send Money has no switch because turning it off would stop the
     * product working — it is the only type `resolve.ts` will match.
     */
    captureCashIn: boolean('capture_cash_in').notNull().default(false),
    captureOutgoing: boolean('capture_outgoing').notNull().default(false),
    captureOther: boolean('capture_other').notNull().default(false),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    // Globally unique, not per business. One physical bKash number cannot be
    // watched by two merchants at once: the captures would be indistinguishable
    // and each would see the other's incoming money.
    uniqueIndex('ux_receiving_accounts_msisdn').on(table.msisdn),
    index('ix_receiving_accounts_status').on(table.status),
    index('ix_receiving_accounts_business').on(table.businessId, table.status),
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

    /**
     * Null until the device claims its provisioning token. A `pending` device
     * has a QR waiting to be scanned and cannot authenticate yet.
     */
    tokenPrefix: text('token_prefix'),
    tokenHash: text('token_hash'),
    status: deviceStatusEnum('status').notNull().default('pending'),

    /**
     * One-time provisioning, per docs/android.md: the dashboard shows a QR, the
     * app exchanges it for a long-lived device token, and the one-time value is
     * burned. Hashed like every other credential — a screenshot of a QR left in
     * a chat is not a way into the capture endpoint.
     */
    provisioningHash: text('provisioning_hash'),
    /**
     * SHA-256 of the pairing code, for finding this row.
     *
     * The code is the *only* thing in the QR — there is no device id beside it
     * to look up by, because the QR has to be a bare URL that any scanner app
     * will open. So the code has to locate its own row, and an argon2 hash
     * cannot be searched.
     *
     * A plain digest is enough here and Argon2 would be theatre: the code is 32
     * random bytes, so there is no dictionary to run against it. `provisioning_hash`
     * still does the verifying — this only decides which row to verify against.
     */
    pairingLookup: text('pairing_lookup'),
    provisioningExpiresAt: timestampTz('provisioning_expires_at'),
    provisionedAt: timestampTz('provisioned_at'),
    /** Bumped on every rotation, so the dashboard can show token age. */
    tokenIssuedAt: timestampTz('token_issued_at'),

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
    // Partial: many devices can sit at 'pending' with a null prefix at once.
    uniqueIndex('ux_devices_token_prefix')
      .on(table.tokenPrefix)
      .where(sql`token_prefix is not null`),
    // The pairing lookup. Unique so a redemption is an exact single-row hit,
    // and partial because it is cleared the moment the code is burned.
    uniqueIndex('ux_devices_pairing_lookup')
      .on(table.pairingLookup)
      .where(sql`pairing_lookup is not null`),
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

export const receivingAccountsRelations = relations(receivingAccounts, ({ one, many }) => ({
  business: one(businesses, {
    fields: [receivingAccounts.businessId],
    references: [businesses.id],
  }),
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
