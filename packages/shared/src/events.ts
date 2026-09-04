import type { MatchConfidence, MatchedBy, Provider, RefundReason } from './types'

/** Outbound webhook contract. docs/api.md is the source of truth for this file. */

export const WEBHOOK_EVENT_TYPES = [
  'payment.succeeded',
  'payment.partial',
  'payment.overpaid',
  'payment.expired',
  'payment.cancelled',
  'payment.reversed',
  'payment.refund_requested',
  'account.degraded',
  'account.recovered',
] as const
export type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number]

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
  /** Present on payment.partial. */
  shortfall?: number
  /** Present on payment.overpaid. */
  excess?: number
  /**
   * Present on payment.refund_requested.
   *
   * Jomma records the ask and forwards it; it never moves money out. The store
   * refunds from its own system, where the order is.
   */
  refund_request?: {
    id: string
    reason: RefundReason
    amount: number
    note: string | null
  }
  /** Present on payment.reversed — why an approved match was undone. */
  reason?: string
}

export interface AccountEventData {
  account_id: string
  provider: Provider
  msisdn: string
  status: string
  reason: string
}

export interface WebhookEvent<T = PaymentEventData | AccountEventData> {
  id: string
  type: WebhookEventType
  created_at: string
  data: T
}

/**
 * At-least-once with a fixed backoff ladder. Seven attempts across roughly 34
 * hours; after the last one the delivery is marked `failed` and surfaced in the
 * dashboard for manual replay.
 */
export const WEBHOOK_RETRY_DELAYS_SECONDS = [10, 60, 300, 1_800, 7_200, 21_600, 86_400] as const
export const WEBHOOK_MAX_ATTEMPTS = WEBHOOK_RETRY_DELAYS_SECONDS.length + 1

/** Signature freshness window. Receivers reject anything older. */
export const WEBHOOK_TOLERANCE_SECONDS = 300

export const SIGNATURE_HEADER = 'x-jomma-signature'
export const EVENT_ID_HEADER = 'x-jomma-event-id'
export const EVENT_TYPE_HEADER = 'x-jomma-event-type'

/** `t=1756909512,v1=<hex>` */
export function formatSignatureHeader(timestamp: number, hexDigest: string): string {
  return `t=${timestamp},v1=${hexDigest}`
}

export function parseSignatureHeader(
  header: string | null | undefined,
): { timestamp: number; signatures: string[] } | null {
  if (!header) return null
  let timestamp: number | null = null
  const signatures: string[] = []
  for (const part of header.split(',')) {
    const [key, value] = part.trim().split('=', 2)
    if (!key || !value) continue
    if (key === 't') {
      const parsed = Number.parseInt(value, 10)
      if (Number.isFinite(parsed)) timestamp = parsed
    } else if (key === 'v1') {
      signatures.push(value)
    }
  }
  if (timestamp === null || signatures.length === 0) return null
  return { timestamp, signatures }
}

/** The exact bytes that get signed: `${timestamp}.${rawBody}`. */
export function signingPayload(timestamp: number, rawBody: string): string {
  return `${timestamp}.${rawBody}`
}
