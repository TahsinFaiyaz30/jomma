/**
 * Wire types.
 *
 * Hand-written rather than imported from the server: the SDK is published and
 * must not drag the whole schema, Drizzle, or Zod into a client app's
 * dependency tree. It is types, signing, and retries — no business logic.
 */

export type Provider = 'bkash' | 'nagad'
export type ProviderPreference = Provider | 'any'

export type IntentStatus = 'open' | 'matched' | 'partial' | 'over' | 'expired' | 'cancelled'

export type MatchConfidence = 'exact' | 'fuzzy' | 'sender' | 'lock' | 'manual'
export type MatchedBy = 'automatic' | 'submission' | 'admin'

/** All nine outcomes of POST /v1/submissions. */
export type SubmissionResolution =
  | 'exact'
  | 'sender_mismatch'
  | 'underpaid'
  | 'overpaid'
  | 'not_found_recent'
  | 'not_found_stale'
  | 'already_used'
  | 'wrong_type'
  | 'expired_intent'

export interface ReceivingAccountRef {
  provider: Provider
  msisdn: string
  display_name: string
}

export interface AppliedPayment {
  trx_id: string | null
  sender_msisdn: string | null
  /** Poisha. */
  amount: number
  occurred_at: string | null
  applied_at: string
  match_confidence: MatchConfidence
  matched_by: MatchedBy
}

export interface Intent {
  id: string
  status: IntentStatus
  /** Poisha. ৳1,200.00 is 120000. */
  amount: number
  received_amount: number
  ref_code: string | null
  receiving_account: ReceivingAccountRef
  client_reference: string
  payments: AppliedPayment[]
  /** What the buyer still owes, when `status` is `partial`. */
  shortfall: number
  /** What they overpaid, when `status` is `over`. */
  excess: number
  metadata: Record<string, unknown>
  expires_at: string
  created_at: string
  request_id: string
}

export interface CreateIntentParams {
  /** Poisha. Integer, always. */
  amount: number
  clientReference: string
  /** Optional. Boosts match confidence when the buyer pays from this number. */
  payerMsisdn?: string | null
  provider?: ProviderPreference
  /** Default 300, max 3600. */
  ttlSeconds?: number
  metadata?: Record<string, unknown>
  /**
   * Replaying the same key within 24 hours returns the original intent rather
   * than allocating a second reference code. Generated per call if omitted,
   * which means a retried request WILL allocate a second code — pass your own
   * order id here.
   */
  idempotencyKey?: string
}

export interface SubmissionParams {
  intentId: string
  trxId: string
  senderMsisdn?: string | null
  /** Poisha. What the buyer thinks they sent. */
  claimedAmount?: number | null
}

export interface SubmissionResult {
  resolution: SubmissionResolution
  intent_status: IntentStatus
  received_amount?: number
  shortfall?: number
  excess?: number
  top_up?: {
    amount: number
    ref_code: string | null
    receiving_msisdn: string
  }
  request_id: string
}

export interface AccountSummary {
  provider: Provider
  msisdn: string
  display_name: string
  /** `degraded` still works, but surface a fallback. */
  status: 'active' | 'degraded' | 'disabled'
  health: {
    last_heartbeat_at: string | null
    last_capture_at: string | null
    balance_drift: boolean
  }
  limits: {
    daily_used: number
    daily_limit: number
    utilization: number
  }
}

export type WebhookEventType =
  | 'payment.succeeded'
  | 'payment.partial'
  | 'payment.overpaid'
  | 'payment.expired'
  | 'payment.cancelled'
  | 'payment.reversed'
  | 'account.degraded'
  | 'account.recovered'

export interface PaymentEventData {
  intent_id: string
  client_reference: string
  amount: number
  received_amount: number
  trx_id: string | null
  sender_msisdn: string | null
  match_confidence: MatchConfidence | null
  matched_by: MatchedBy | null
  metadata: Record<string, unknown>
  shortfall?: number
  excess?: number
  reason?: string
}

export interface WebhookEvent<T = PaymentEventData> {
  id: string
  type: WebhookEventType
  created_at: string
  data: T
}

export type ErrorCode =
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'validation_failed'
  | 'no_capacity'
  | 'lock_taken'
  | 'duplicate_submission'
  | 'rate_limited'
  | 'no_healthy_account'
  | 'internal_error'
