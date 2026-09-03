import {
  ACCOUNT_STATUSES,
  ADAPTER_RELIABILITY,
  ALERT_SEVERITIES,
  AUDIT_ACTIONS,
  CAPTURE_SOURCES,
  DELIVERY_STATUSES,
  DEVICE_STATUSES,
  INGEST_ADAPTERS,
  INTENT_STATUSES,
  KEY_ENVIRONMENTS,
  LOCK_STATUSES,
  MATCH_CONFIDENCES,
  MATCHED_BY,
  NOTIFIER_EVENT_KINDS,
  PARSE_STATUSES,
  PAYMENT_STATUSES,
  PROVIDER_PREFERENCES,
  PROVIDERS,
  REF_STATUSES,
  SUBMISSION_RESOLUTIONS,
  SUBMISSION_STATUSES,
  TRANSACTION_TYPES,
  WEBHOOK_EVENT_TYPES,
} from '@jomma/shared'
import { pgEnum } from 'drizzle-orm/pg-core'

/**
 * Every enum is generated from the const tuple in @jomma/shared, so the database
 * type, the Zod schema, and the TypeScript union cannot drift apart.
 */

export const providerEnum = pgEnum('provider', PROVIDERS)
export const providerPreferenceEnum = pgEnum('provider_preference', PROVIDER_PREFERENCES)
export const accountStatusEnum = pgEnum('account_status', ACCOUNT_STATUSES)
export const deviceStatusEnum = pgEnum('device_status', DEVICE_STATUSES)
export const intentStatusEnum = pgEnum('intent_status', INTENT_STATUSES)
export const refStatusEnum = pgEnum('ref_status', REF_STATUSES)
export const lockStatusEnum = pgEnum('lock_status', LOCK_STATUSES)
export const paymentStatusEnum = pgEnum('payment_record_status', PAYMENT_STATUSES)
export const transactionTypeEnum = pgEnum('transaction_type', TRANSACTION_TYPES)
export const parseStatusEnum = pgEnum('parse_status', PARSE_STATUSES)
export const captureSourceEnum = pgEnum('capture_source', CAPTURE_SOURCES)
export const ingestAdapterEnum = pgEnum('ingest_adapter', INGEST_ADAPTERS)
export const adapterReliabilityEnum = pgEnum('adapter_reliability', ADAPTER_RELIABILITY)
export const submissionStatusEnum = pgEnum('submission_status', SUBMISSION_STATUSES)
export const submissionResolutionEnum = pgEnum('submission_resolution', SUBMISSION_RESOLUTIONS)
export const matchConfidenceEnum = pgEnum('match_confidence', MATCH_CONFIDENCES)
export const matchedByEnum = pgEnum('matched_by', MATCHED_BY)
export const notifierEventKindEnum = pgEnum('notifier_event_kind', NOTIFIER_EVENT_KINDS)
export const alertSeverityEnum = pgEnum('alert_severity', ALERT_SEVERITIES)
export const keyEnvironmentEnum = pgEnum('key_environment', KEY_ENVIRONMENTS)
export const deliveryStatusEnum = pgEnum('delivery_status', DELIVERY_STATUSES)
export const webhookEventTypeEnum = pgEnum('webhook_event_type', WEBHOOK_EVENT_TYPES)
export const auditActionEnum = pgEnum('audit_action', AUDIT_ACTIONS)
export const appStatusEnum = pgEnum('app_status', ['active', 'suspended'])
export const idempotencyStatusEnum = pgEnum('idempotency_status', ['in_progress', 'completed'])
