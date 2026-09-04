import { relations } from 'drizzle-orm'
import { index, integer, jsonb, pgTable, text, uniqueIndex, varchar } from 'drizzle-orm/pg-core'
import { createdAt, fkId, poisha, primaryId, timestampTz, updatedAt } from './_shared'
import { devices, receivingAccounts } from './accounts'
import { apps } from './apps'
import {
  captureSourceEnum,
  ingestAdapterEnum,
  intentStatusEnum,
  matchConfidenceEnum,
  matchedByEnum,
  parseStatusEnum,
  paymentStatusEnum,
  providerEnum,
  providerPreferenceEnum,
  refStatusEnum,
  refundReasonEnum,
  refundRequestStatusEnum,
  submissionResolutionEnum,
  submissionStatusEnum,
  transactionTypeEnum,
} from './enums'

/**
 * A payment request.
 *
 * docs/matching.md was written from inside an ecommerce app, where this row was
 * the `order`. Standalone Jomma does not own orders — it owns the intent and
 * stores the client's opaque `clientReference`. The `*_id` columns on the tables
 * below therefore point at an intent, not an order.
 */
export const paymentIntents = pgTable(
  'payment_intents',
  {
    id: primaryId(),
    appId: fkId('app_id')
      .notNull()
      .references(() => apps.id, { onDelete: 'cascade' }),
    receivingAccountId: fkId('receiving_account_id')
      .notNull()
      .references(() => receivingAccounts.id, { onDelete: 'restrict' }),

    amountCents: poisha('amount_cents').notNull(),
    receivedAmountCents: poisha('received_amount_cents').notNull().default(0),

    /** Opaque to Jomma. Handed straight back on the webhook. */
    clientReference: text('client_reference').notNull(),
    payerMsisdn: text('payer_msisdn'),
    providerPreference: providerPreferenceEnum('provider_preference').notNull().default('any'),

    /**
     * Where the hosted pay page sends the buyer afterwards.
     *
     * This is what lets Jomma sit in front of a storefront it knows nothing
     * about: the store redirects to `/pay/:id` and names where to come back to.
     * Both are validated as absolute http(s) URLs on the way in — an unchecked
     * redirect target on a payment page is an open redirect, and a phishing page
     * that has already been handed the buyer is about as bad as those get.
     */
    returnUrl: text('return_url'),
    cancelUrl: text('cancel_url'),

    status: intentStatusEnum('status').notNull().default('open'),
    metadata: jsonb('metadata').notNull().default({}).$type<Record<string, unknown>>(),

    ttlSeconds: integer('ttl_seconds').notNull(),
    expiresAt: timestampTz('expires_at').notNull(),

    /** Server clock, used for the ±10 minute recency signal in the scorer. */
    payClickedAt: timestampTz('pay_clicked_at').notNull().defaultNow(),
    matchedAt: timestampTz('matched_at'),
    cancelledAt: timestampTz('cancelled_at'),
    expiredAt: timestampTz('expired_at'),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index('ix_intents_app_reference').on(table.appId, table.clientReference),
    // The expiry sweep.
    index('ix_intents_open_expiry').on(table.status, table.expiresAt),
    // The matcher's candidate query: open intents on this account at this amount.
    index('ix_intents_candidates').on(table.receivingAccountId, table.amountCents, table.status),
    index('ix_intents_recent').on(table.createdAt),
  ],
)

/**
 * An 8-character reference code, unique across the whole table.
 *
 * Not "unique among the open ones" — unique full stop, for all time. A code is
 * never issued to a second intent, which is what makes it safe to treat as the
 * identifier: now that the amount identifies nothing, this is the thing that
 * says whose money a payment is.
 */
export const paymentRefs = pgTable(
  'payment_refs',
  {
    id: primaryId(),
    code: varchar('code', { length: 8 }).notNull(),
    intentId: fkId('intent_id')
      .notNull()
      .references(() => paymentIntents.id, { onDelete: 'cascade' }),
    status: refStatusEnum('status').notNull().default('open'),
    expiresAt: timestampTz('expires_at').notNull(),
    consumedAt: timestampTz('consumed_at'),
    createdAt: createdAt(),
  },
  (table) => [
    // Total, not partial. A code belongs to exactly one intent, ever.
    uniqueIndex('ux_payment_refs_code').on(table.code),
    index('ix_payment_refs_intent').on(table.intentId),
  ],
)

/**
 * Observed money. Nothing in Jomma marks a payment succeeded without a row here.
 *
 * `rawMessage` is written before any parsing runs, so a provider changing its
 * format costs a parse failure and an alert, never a lost payment.
 */
export const incomingPayments = pgTable(
  'incoming_payments',
  {
    id: primaryId(),
    receivingAccountId: fkId('receiving_account_id')
      .notNull()
      .references(() => receivingAccounts.id, { onDelete: 'restrict' }),
    deviceId: fkId('device_id').references(() => devices.id, {
      onDelete: 'set null',
    }),
    provider: providerEnum('provider').notNull(),

    /**
     * The single constraint that deduplicates duplicate delivery, deliberate
     * dual capture (notification + SMS), retries, and statement re-imports.
     *
     * Nullable because an unparseable message has no TrxID yet and must still be
     * stored. Postgres treats NULLs as distinct in a unique index, so failed
     * parses never collide with each other.
     */
    trxId: text('trx_id'),

    senderMsisdn: text('sender_msisdn'),
    amountCents: poisha('amount_cents'),
    balanceAfterCents: poisha('balance_after_cents'),

    referenceRaw: text('reference_raw'),
    referenceNormalized: text('reference_normalized'),

    transactionType: transactionTypeEnum('transaction_type'),

    /** From the message. Display only — phone clocks drift. */
    occurredAt: timestampTz('occurred_at'),
    /** Device clock at capture. Display only. */
    capturedAt: timestampTz('captured_at'),
    /** Server clock. Authoritative for every window calculation. */
    receivedAt: timestampTz('received_at').notNull().defaultNow(),

    rawMessage: text('raw_message').notNull(),
    packageName: text('package_name'),
    /** Device-side queue id, echoed back in the capture ack. */
    localId: text('local_id'),

    source: captureSourceEnum('source').notNull(),
    adapter: ingestAdapterEnum('adapter').notNull(),
    parseStatus: parseStatusEnum('parse_status').notNull().default('ok'),
    parseError: text('parse_error'),

    status: paymentStatusEnum('status').notNull().default('unmatched'),

    /** Orphan retry bookkeeping: every 30s for 10 minutes before queueing. */
    matchAttempts: integer('match_attempts').notNull().default(0),
    lastMatchAttemptAt: timestampTz('last_match_attempt_at'),

    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('ux_incoming_payments_trx').on(table.trxId),
    index('ix_incoming_payments_feed').on(table.receivedAt),
    index('ix_incoming_payments_status').on(table.status, table.receivedAt),
    index('ix_incoming_payments_candidates').on(
      table.receivingAccountId,
      table.amountCents,
      table.status,
    ),
    index('ix_incoming_payments_reference').on(table.referenceNormalized),
    index('ix_incoming_payments_parse_failures').on(table.parseStatus, table.receivedAt),
  ],
)

/**
 * The join. Named `order_payments` because that is what docs/matching.md calls
 * it; the foreign key points at an intent.
 *
 * Underpayment is cumulative: two ৳600 rows satisfy a ৳1,200 intent. Never
 * replace, always sum.
 */
export const orderPayments = pgTable(
  'order_payments',
  {
    id: primaryId(),
    intentId: fkId('intent_id')
      .notNull()
      .references(() => paymentIntents.id, { onDelete: 'cascade' }),
    incomingPaymentId: fkId('incoming_payment_id')
      .notNull()
      .references(() => incomingPayments.id, { onDelete: 'restrict' }),
    appliedCents: poisha('applied_cents').notNull(),
    appliedAt: timestampTz('applied_at').notNull().defaultNow(),
    /** Null actor means the matcher did it with no human involved. */
    appliedBy: fkId('applied_by'),

    matchConfidence: matchConfidenceEnum('match_confidence').notNull(),
    matchedBy: matchedByEnum('matched_by').notNull(),
    matchScore: integer('match_score'),

    /** A reversal is a new state on this row plus an audit entry. Never a delete. */
    reversedAt: timestampTz('reversed_at'),
    reversedBy: fkId('reversed_by'),
    reversalReason: text('reversal_reason'),

    createdAt: createdAt(),
  },
  (table) => [
    // One payment can only ever be applied once, to one intent.
    uniqueIndex('ux_order_payments_incoming').on(table.incomingPaymentId),
    uniqueIndex('ux_order_payments_pair').on(table.intentId, table.incomingPaymentId),
    index('ix_order_payments_intent').on(table.intentId),
  ],
)

/** The manual path: a buyer types a TrxID because automatic matching didn't fire. */
export const paymentSubmissions = pgTable(
  'payment_submissions',
  {
    id: primaryId(),
    intentId: fkId('intent_id')
      .notNull()
      .references(() => paymentIntents.id, { onDelete: 'cascade' }),
    appId: fkId('app_id')
      .notNull()
      .references(() => apps.id, { onDelete: 'cascade' }),

    trxId: text('trx_id').notNull(),
    senderMsisdn: text('sender_msisdn'),
    claimedAmountCents: poisha('claimed_amount_cents'),

    status: submissionStatusEnum('status').notNull().default('pending'),
    resolution: submissionResolutionEnum('resolution'),
    incomingPaymentId: fkId('incoming_payment_id').references(() => incomingPayments.id, {
      onDelete: 'set null',
    }),

    reviewedBy: fkId('reviewed_by'),
    reviewedAt: timestampTz('reviewed_at'),
    note: text('note'),
    /** Logged for every submission — spam and fraud patterns show up by IP. */
    ip: text('ip'),

    createdAt: createdAt(),
  },
  (table) => [
    // Rate limit: 5 per intent per hour.
    index('ix_submissions_intent_recent').on(table.intentId, table.createdAt),
    index('ix_submissions_trx').on(table.trxId),
    index('ix_submissions_app_recent').on(table.appId, table.createdAt),
  ],
)

export const paymentIntentsRelations = relations(paymentIntents, ({ one, many }) => ({
  app: one(apps, { fields: [paymentIntents.appId], references: [apps.id] }),
  receivingAccount: one(receivingAccounts, {
    fields: [paymentIntents.receivingAccountId],
    references: [receivingAccounts.id],
  }),
  refs: many(paymentRefs),
  applications: many(orderPayments),
  submissions: many(paymentSubmissions),
}))

export const paymentRefsRelations = relations(paymentRefs, ({ one }) => ({
  intent: one(paymentIntents, {
    fields: [paymentRefs.intentId],
    references: [paymentIntents.id],
  }),
}))

export const incomingPaymentsRelations = relations(incomingPayments, ({ one, many }) => ({
  account: one(receivingAccounts, {
    fields: [incomingPayments.receivingAccountId],
    references: [receivingAccounts.id],
  }),
  device: one(devices, {
    fields: [incomingPayments.deviceId],
    references: [devices.id],
  }),
  applications: many(orderPayments),
}))

export const orderPaymentsRelations = relations(orderPayments, ({ one }) => ({
  intent: one(paymentIntents, {
    fields: [orderPayments.intentId],
    references: [paymentIntents.id],
  }),
  incomingPayment: one(incomingPayments, {
    fields: [orderPayments.incomingPaymentId],
    references: [incomingPayments.id],
  }),
}))

export const paymentSubmissionsRelations = relations(paymentSubmissions, ({ one }) => ({
  intent: one(paymentIntents, {
    fields: [paymentSubmissions.intentId],
    references: [paymentIntents.id],
  }),
  incomingPayment: one(incomingPayments, {
    fields: [paymentSubmissions.incomingPaymentId],
    references: [incomingPayments.id],
  }),
}))

/**
 * A buyer asking the store to give money back, or to cancel the order.
 *
 * Jomma does not move money out — it has no payout path and should not have
 * one. What it can do is record the ask, tie it to the payment it is about, and
 * tell the store over the same signed webhook it hears everything else on. The
 * refund itself happens in the store's own system, where the order lives.
 *
 * Kept as its own table rather than a flag on the intent because a buyer can
 * ask more than once, and because the record has to survive the intent being
 * completed — which it always is by the time an overpayment is noticed.
 */
export const refundRequests = pgTable(
  'refund_requests',
  {
    id: primaryId(),
    intentId: fkId('intent_id')
      .notNull()
      .references(() => paymentIntents.id, { onDelete: 'cascade' }),
    reason: refundReasonEnum('reason').notNull(),
    status: refundRequestStatusEnum('status').notNull().default('open'),

    /** What the buyer believes they are owed. Advisory — the store decides. */
    amountCents: poisha('amount_cents'),
    /** Free text from the buyer, capped at the API boundary. */
    note: text('note'),
    /** How to reach them, if they gave it. */
    contactMsisdn: text('contact_msisdn'),

    resolvedAt: timestampTz('resolved_at'),
    resolvedBy: fkId('resolved_by'),
    resolutionNote: text('resolution_note'),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index('ix_refund_requests_intent').on(table.intentId),
    // The dashboard's open list, worst first.
    index('ix_refund_requests_open').on(table.status, table.createdAt),
  ],
)

export const refundRequestsRelations = relations(refundRequests, ({ one }) => ({
  intent: one(paymentIntents, {
    fields: [refundRequests.intentId],
    references: [paymentIntents.id],
  }),
}))
