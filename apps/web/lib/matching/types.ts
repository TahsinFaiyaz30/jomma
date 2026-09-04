import type { IntentStatus, MatchConfidence, TransactionType } from '@jomma/shared'

/**
 * The matcher's inputs are plain data, never database rows. Nothing in this
 * directory imports a client, a schema, or `env` — it is unit-testable with no
 * Postgres anywhere near it.
 */

export interface ObservedPayment {
  id: string
  receivingAccountId: string
  /** Null when the parser failed. A null amount can never clear the gate. */
  amountCents: number | null
  senderMsisdn: string | null
  /** Straight off the message, before normalisation. */
  referenceRaw: string | null
  transactionType: TransactionType | null
  /** Server clock. When Jomma first saw it, not when it happened. */
  receivedAt: Date
  /**
   * The time in the provider's own message, in UTC.
   *
   * This is the trustworthy clock. A notification can be delayed, re-delivered
   * or captured late, and the server sees it whenever it arrives — but the
   * timestamp bKash wrote into the message never changes. Null when the parser
   * could not read a date, in which case the window falls back to `receivedAt`.
   */
  occurredAt: Date | null
}

export interface CandidateIntent {
  id: string
  receivingAccountId: string
  amountCents: number
  /**
   * What is still owed. Equals `amountCents` for a fresh intent; for one that is
   * already `partial` it is the shortfall, so a top-up of exactly the remaining
   * balance clears the gate. Underpayment is cumulative, never replace.
   */
  outstandingCents: number
  refCode: string | null
  expectedMsisdn: string | null
  /** Server clock, set when the intent was created. */
  payClickedAt: Date
  expiresAt: Date
  status: IntentStatus
}

export interface SignalBreakdown {
  referenceExact: boolean
  referenceFuzzy: boolean
  senderMatch: boolean
  withinWindow: boolean
}

export interface ScoredCandidate {
  intent: CandidateIntent
  score: number
  signals: SignalBreakdown
  confidence: MatchConfidence | null
}

export type MatchResult =
  | {
      kind: 'matched'
      candidate: ScoredCandidate
      /** Kept for the audit trail — what it beat, and by how much. */
      runnerUp: ScoredCandidate | null
      margin: number | null
    }
  | {
      kind: 'ambiguous'
      reason: 'multiple_above_threshold' | 'below_threshold' | 'wrong_transaction_type'
      candidates: ScoredCandidate[]
    }
  | {
      kind: 'unmatched'
      reason: 'no_candidates' | 'amount_gate' | 'unparsed'
    }

export interface MatchOptions {
  /** A single candidate at or above this auto-approves. Default 100. */
  approveThreshold?: number
  /** How far the top must beat the runner-up when both clear the bar. Default 60. */
  ambiguityMargin?: number
  /** Recency window in minutes. Default 10. */
  windowMinutes?: number
}
