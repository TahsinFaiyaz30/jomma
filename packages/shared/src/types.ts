/**
 * Domain vocabulary shared by web and worker.
 *
 * Every enum is a `const` tuple so it can drive a Drizzle pgEnum, a Zod schema,
 * and a TypeScript union from one declaration. Adding a value in one place and
 * forgetting the other two is the classic way these drift.
 */

/**
 * How this deployment is being run.
 *
 * `single` is a shop hosting Jomma for itself: one business, every user in it,
 * no signup, and no business named anywhere in the UI because there is nothing
 * to distinguish it from. `service` is one instance serving unrelated
 * merchants, who must never see each other.
 *
 * This changes what the dashboard *shows*. It must never change what a query
 * *does* — both modes run the same scoped reads, because the single-tenant path
 * is the one nobody is probing and therefore the one where a missing filter
 * would sit undiscovered until the day it is not single-tenant any more.
 */
export const DEPLOYMENT_MODES = ['single', 'service'] as const
export type DeploymentMode = (typeof DEPLOYMENT_MODES)[number]

/**
 * Where a business sits with the platform.
 *
 * Signing up is free and instant; operating is not. Anyone can create an
 * account and describe a business, but until a platform admin approves it the
 * business cannot take a payment — no live API key, no routable account, no
 * device pairing. That gate is the point: this software moves other people's
 * money through personal MFS numbers, and an instance that let anyone
 * self-serve their way to a live integration would be a laundering service with
 * a dashboard.
 *
 * `pending` is therefore the default, and it is a working state rather than a
 * waiting room — a merchant can set everything up, look around, and read the
 * documentation. What they cannot do is receive.
 *
 * `rejected` is kept rather than deleted so the same person cannot simply
 * re-apply into a clean slate, and so the reason survives the conversation.
 */
export const BUSINESS_STATUSES = ['pending', 'active', 'rejected', 'suspended'] as const
export type BusinessStatus = (typeof BUSINESS_STATUSES)[number]

/** A business that may actually move money. The only status that can route. */
export const isBusinessLive = (status: BusinessStatus): boolean => status === 'active'

/**
 * Platform-level authority, which is not the same thing as a role in a business.
 *
 * A `platform_admin` runs the deployment: they approve businesses, suspend
 * them, and see the instance's own health. They are not thereby a member of any
 * business and do not get its payment data — those are separate grants, because
 * "can approve a merchant" and "can read that merchant's takings" are different
 * powers and only one of them is needed to do the job.
 *
 * `member` is the default and what every signup gets. It was `admin` before
 * this, which was safe only because there was no public signup; with one, that
 * default would have handed the instance to the first stranger who registered.
 */
export const PLATFORM_ROLES = ['member', 'platform_admin'] as const
export type PlatformRole = (typeof PLATFORM_ROLES)[number]

/**
 * What a member may do. The line is drawn at money, not seniority.
 *
 * `viewer` is the one that earns its place: somebody has to be able to watch
 * the feed through a shift without being able to approve a payment into
 * existence.
 */
export const MEMBERSHIP_ROLES = ['owner', 'admin', 'viewer'] as const
export type MembershipRole = (typeof MEMBERSHIP_ROLES)[number]

export const PROVIDERS = ['bkash', 'nagad'] as const
export type Provider = (typeof PROVIDERS)[number]

/** `any` lets an intent be satisfied by whichever healthy account is routed. */
export const PROVIDER_PREFERENCES = ['bkash', 'nagad', 'any'] as const
export type ProviderPreference = (typeof PROVIDER_PREFERENCES)[number]

export const ACCOUNT_STATUSES = ['active', 'degraded', 'disabled'] as const
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number]

export const INTENT_STATUSES = [
  'open',
  'matched',
  'partial',
  'over',
  'expired',
  'cancelled',
] as const
export type IntentStatus = (typeof INTENT_STATUSES)[number]

export const REF_STATUSES = ['open', 'consumed', 'expired'] as const
export type RefStatus = (typeof REF_STATUSES)[number]

/**
 * Locks carry an explicit status rather than relying on `expires_at` alone.
 * Postgres will not accept `now()` in a partial index predicate (it is STABLE,
 * not IMMUTABLE), so the uniqueness guarantee in docs/matching.md is enforced as
 * `unique (receiving_account_id, amount_cents) where status = 'active'` and the
 * worker sweeps `active` -> `expired`. Read paths still check `expires_at`, so a
 * lock the sweeper has not reached yet is never treated as held.
 */
export const LOCK_STATUSES = ['active', 'consumed', 'released', 'expired'] as const
export type LockStatus = (typeof LOCK_STATUSES)[number]

export const PAYMENT_STATUSES = ['unmatched', 'matched', 'orphaned', 'refunded'] as const
export type PaymentRecordStatus = (typeof PAYMENT_STATUSES)[number]

export const TRANSACTION_TYPES = ['send_money', 'cash_in', 'outgoing', 'other'] as const
export type TransactionType = (typeof TRANSACTION_TYPES)[number]

/**
 * What a watched number keeps besides incoming Send Money.
 *
 * A provider app emits far more than payments — promotions, balance notices,
 * cash-in confirmations, the operator's own outgoing transfers. Storing all of
 * it buries the one type that settles an order in noise nobody reads.
 *
 * Incoming Send Money has no switch here, and that omission is the design.
 * `matching/resolve.ts` will only match `send_money`, so a toggle for it would
 * be a toggle that turns the product off.
 *
 * Keyed in wire form because this shape crosses the device API verbatim.
 */
export interface CaptureSettings {
  /** Agent and app cash-in landing on this number. */
  cash_in: boolean
  /** Money this number *sent*. Useful as a ledger, never matchable. */
  outgoing: boolean
  /** Everything else the provider pushes, promotions included. */
  other: boolean
}

export const DEFAULT_CAPTURE_SETTINGS: CaptureSettings = {
  cash_in: false,
  outgoing: false,
  other: false,
}

export const PARSE_STATUSES = ['ok', 'partial', 'failed'] as const
export type ParseStatus = (typeof PARSE_STATUSES)[number]

export const CAPTURE_SOURCES = [
  'notification',
  'sms',
  'manual_entry',
  'statement',
  'generic_webhook',
  'bridge',
] as const
export type CaptureSource = (typeof CAPTURE_SOURCES)[number]

export const INGEST_ADAPTERS = [
  'android_notification',
  'android_sms',
  'messages_bridge',
  'manual_entry',
  'statement_import',
  'generic_webhook',
] as const
export type IngestAdapterId = (typeof INGEST_ADAPTERS)[number]

export const ADAPTER_RELIABILITY = ['primary', 'secondary', 'best_effort'] as const
export type AdapterReliability = (typeof ADAPTER_RELIABILITY)[number]

export interface IngestAdapter {
  id: IngestAdapterId
  reliability: AdapterReliability
}

export const ADAPTERS: Record<IngestAdapterId, IngestAdapter> = {
  android_notification: { id: 'android_notification', reliability: 'primary' },
  android_sms: { id: 'android_sms', reliability: 'primary' },
  manual_entry: { id: 'manual_entry', reliability: 'secondary' },
  statement_import: { id: 'statement_import', reliability: 'secondary' },
  generic_webhook: { id: 'generic_webhook', reliability: 'secondary' },
  messages_bridge: { id: 'messages_bridge', reliability: 'best_effort' },
}

/** What a buyer asked the store to do about money they should not have paid. */
export const REFUND_REASONS = ['overpaid', 'cancel_order', 'other'] as const
export type RefundReason = (typeof REFUND_REASONS)[number]

export const REFUND_REQUEST_STATUSES = ['open', 'acknowledged', 'resolved', 'declined'] as const
export type RefundRequestStatus = (typeof REFUND_REQUEST_STATUSES)[number]

export const SUBMISSION_STATUSES = ['pending', 'approved', 'rejected', 'superseded'] as const
export type SubmissionStatus = (typeof SUBMISSION_STATUSES)[number]

/** The nine outcomes in docs/api.md. Ordered as the table is. */
export const SUBMISSION_RESOLUTIONS = [
  'exact',
  'sender_mismatch',
  'underpaid',
  'overpaid',
  'not_found_recent',
  'not_found_stale',
  'already_used',
  'wrong_type',
  'expired_intent',
] as const
export type SubmissionResolution = (typeof SUBMISSION_RESOLUTIONS)[number]

export const MATCH_CONFIDENCES = ['exact', 'fuzzy', 'sender', 'lock', 'manual'] as const
export type MatchConfidence = (typeof MATCH_CONFIDENCES)[number]

export const MATCHED_BY = ['automatic', 'submission', 'admin'] as const
export type MatchedBy = (typeof MATCHED_BY)[number]

export const NOTIFIER_EVENT_KINDS = [
  'heartbeat',
  'capture',
  'error',
  'permission_lost',
  'service_restarted',
  'boot',
  'parse_hint',
  'bridge_session_lost',
  'parse_failure',
  'balance_drift',
  'capture_silence',
  'heartbeat_gap',
] as const
export type NotifierEventKind = (typeof NOTIFIER_EVENT_KINDS)[number]

/** Kinds the device is allowed to POST to /device/v1/events. */
export const DEVICE_REPORTABLE_EVENT_KINDS = [
  'permission_lost',
  'service_restarted',
  'boot',
  'parse_hint',
  'bridge_session_lost',
] as const
export type DeviceReportableEventKind = (typeof DEVICE_REPORTABLE_EVENT_KINDS)[number]

export const DEVICE_COMMANDS = ['flush_queue', 'resend_since', 'rotate_token', 'stop'] as const
export type DeviceCommandType = (typeof DEVICE_COMMANDS)[number]

export type DeviceCommand =
  | { type: 'flush_queue' }
  | { type: 'resend_since'; since: string }
  | { type: 'rotate_token' }
  | { type: 'stop' }

/** `pending` is a device that has a provisioning QR but has not scanned it yet. */
/**
 * Where a phone is in its life.
 *
 * `awaiting_approval` sits between scanning and working, and it is the whole
 * point of the pairing gate. A QR is a bearer credential: it is fifteen minutes
 * long, it gets screenshotted, it gets forwarded, and anyone holding it can
 * complete a pairing. So completing one no longer earns anything. The phone
 * gets its token, and the token does nothing until someone at the dashboard
 * says that phone is theirs.
 *
 * The token is issued at scan rather than at approval on purpose: handing it
 * over later would mean storing a plaintext credential somewhere in between,
 * waiting to be collected. Issuing it immediately and refusing to honour it is
 * the same guarantee without the storage.
 */
export const DEVICE_STATUSES = ['pending', 'awaiting_approval', 'active', 'revoked'] as const
export type DeviceStatus = (typeof DEVICE_STATUSES)[number]

export const KEY_ENVIRONMENTS = ['live', 'test'] as const
export type KeyEnvironment = (typeof KEY_ENVIRONMENTS)[number]

export const DELIVERY_STATUSES = ['pending', 'delivering', 'delivered', 'failed'] as const
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number]

export const ALERT_SEVERITIES = ['critical', 'high', 'medium', 'low'] as const
export type AlertSeverity = (typeof ALERT_SEVERITIES)[number]

export const AUDIT_ACTIONS = [
  'intent.created',
  'intent.cancelled',
  'intent.extended',
  'intent.expired',
  'intent.rerouted',
  'intent.refund_requested',
  'payment.captured',
  'payment.parse_failed',
  'payment.matched',
  'payment.reversed',
  'payment.orphaned',
  'submission.created',
  'submission.resolved',
  'lock.acquired',
  'lock.consumed',
  'lock.released',
  'device.provisioned',
  'device.revoked',
  'account.created',
  'account.degraded',
  'account.recovered',
  'account.updated',
  'balance.drift',
  'apikey.created',
  'apikey.revoked',
  'endpoint.created',
  'webhook.replayed',
  'app.created',
  'app.updated',
  'statement.imported',
] as const
export type AuditAction = (typeof AUDIT_ACTIONS)[number]

/**
 * The provider-agnostic status from docs/matching.md. Client code branches on
 * this and never on a bKash-specific shape.
 */
export type PaymentStatus =
  | { state: 'pending' }
  | { state: 'paid'; trxId: string; amountCents: number; at: Date }
  | { state: 'partial'; receivedCents: number; shortfallCents: number }
  | { state: 'over'; receivedCents: number; excessCents: number }
  | { state: 'failed'; reason: string }

export const LOCALES = ['en', 'bn'] as const
export type Locale = (typeof LOCALES)[number]
