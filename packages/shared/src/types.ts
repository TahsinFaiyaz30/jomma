/**
 * Domain vocabulary shared by web and worker.
 *
 * Every enum is a `const` tuple so it can drive a Drizzle pgEnum, a Zod schema,
 * and a TypeScript union from one declaration. Adding a value in one place and
 * forgetting the other two is the classic way these drift.
 */

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

export const TRANSACTION_TYPES = ['send_money', 'cash_in', 'other'] as const
export type TransactionType = (typeof TRANSACTION_TYPES)[number]

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
export const DEVICE_STATUSES = ['pending', 'active', 'revoked'] as const
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
  'account.degraded',
  'account.recovered',
  'balance.drift',
  'apikey.created',
  'apikey.revoked',
  'endpoint.created',
  'webhook.replayed',
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
