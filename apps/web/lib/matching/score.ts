import type { MatchConfidence } from '@jomma/shared'
import { isFuzzyRefMatch, minutesBetween, normalizeRef, sameMsisdn } from './normalize'
import type {
  CandidateIntent,
  MatchOptions,
  ObservedPayment,
  ScoredCandidate,
  SignalBreakdown,
} from './types'

/**
 * Signal weights. From docs/matching.md — do not tune these without reading it.
 *
 * The shape matters more than the numbers: an exact reference alone clears the
 * approve threshold, and nothing else does on its own. Sender plus lock (110)
 * also clears it, which is deliberate — it is how a buyer who skipped the
 * reference field still gets matched automatically.
 */
export const WEIGHTS = {
  referenceExact: 100,
  referenceFuzzy: 80,
  senderMatch: 60,
  activeLock: 50,
  withinWindow: 20,
} as const

export const DEFAULT_WINDOW_MINUTES = 10

/**
 * How the amount relates to what is still owed.
 *
 * Not a verdict on its own. The reference code is the identifier — it is
 * generated per intent, unique among open ones, and alone clears the approve
 * threshold. Amount is arithmetic once identity is established, and only
 * becomes an identifier when no reference arrived.
 *
 * The receiving account stays an absolute gate: money that landed on the Nagad
 * number cannot settle an intent addressed to the bKash one, however well
 * everything else lines up.
 */
export type AmountFit = 'settles' | 'short' | 'over' | 'none'

export function amountFit(payment: ObservedPayment, intent: CandidateIntent): AmountFit {
  if (payment.amountCents === null) return 'none'
  if (payment.amountCents <= 0) return 'none'
  if (payment.receivingAccountId !== intent.receivingAccountId) return 'none'
  if (payment.amountCents === intent.outstandingCents) return 'settles'
  return payment.amountCents < intent.outstandingCents ? 'short' : 'over'
}

/** Kept for callers that only need the yes/no. */
export function passesGate(payment: ObservedPayment, intent: CandidateIntent): boolean {
  return amountFit(payment, intent) !== 'none'
}

export function holdsActiveLock(payment: ObservedPayment, intent: CandidateIntent): boolean {
  const lock = intent.lock
  if (!lock) return false
  if (lock.status !== 'active') return false
  // A lock the expiry sweep has not reached yet is still an expired lock.
  if (lock.expiresAt.getTime() <= payment.receivedAt.getTime()) return false
  if (lock.receivingAccountId !== payment.receivingAccountId) return false
  return lock.amountCents === payment.amountCents
}

/**
 * Scores one candidate. Returns -Infinity below the gate so a caller that sorts
 * without filtering still cannot promote a gated candidate.
 */
export function score(
  payment: ObservedPayment,
  intent: CandidateIntent,
  options: MatchOptions = {},
): ScoredCandidate {
  const windowMinutes = options.windowMinutes ?? DEFAULT_WINDOW_MINUTES

  const signals: SignalBreakdown = {
    referenceExact: false,
    referenceFuzzy: false,
    senderMatch: false,
    activeLock: false,
    withinWindow: false,
  }

  const fit = amountFit(payment, intent)
  const gated = {
    intent,
    score: Number.NEGATIVE_INFINITY,
    signals,
    confidence: null,
  }

  if (fit === 'none') return gated

  let total = 0
  const reference = normalizeRef(payment.referenceRaw)
  const code = normalizeRef(intent.refCode)

  if (reference && code && reference === code) {
    signals.referenceExact = true
    total += WEIGHTS.referenceExact
  } else if (reference && code && isFuzzyRefMatch(reference, code)) {
    // Fuzzy only, and only at distance 1. Distance 2 on a four-character code is
    // most of the alphabet away and would match the wrong buyer.
    signals.referenceFuzzy = true
    total += WEIGHTS.referenceFuzzy
  }

  /*
   * An amount that does not settle the balance needs the reference to be
   * exactly right.
   *
   * With an exact reference, identity is already established and the amount is
   * just arithmetic — short becomes a part payment, over becomes a completed
   * order plus an excess the merchant is told about. That is the whole point of
   * issuing a code per intent.
   *
   * Without one, the amount *is* the identifier: it is held exclusively by a
   * single open intent on this account, which is what lets a payment with no
   * reference at all still match on sender plus lock. bKash's reference field is
   * optional and buyers skip it, so that path has to keep working — but it only
   * works because the amount is exact, so an inexact amount with no code is not
   * a match, it is a question for a human.
   *
   * Fuzzy is not enough either. A single-character typo plus an arbitrary amount
   * would let one buyer's money land on another buyer's order, and the person
   * whose money moved would have no way to see it.
   *
   * Nothing here rejects a payment. Below this bar it goes to the queue, where a
   * human sees every candidate at once and decides.
   */
  if (fit !== 'settles' && !signals.referenceExact) return gated

  if (sameMsisdn(payment.senderMsisdn, intent.expectedMsisdn)) {
    signals.senderMatch = true
    total += WEIGHTS.senderMatch
  }

  if (holdsActiveLock(payment, intent)) {
    signals.activeLock = true
    total += WEIGHTS.activeLock
  }

  // Absolute difference, not signed: a payment that arrived just *before* the
  // intent committed is the orphan case, and re-matching it is exactly what the
  // 30-second retry loop exists to do.
  if (minutesBetween(intent.payClickedAt, payment.receivedAt) <= windowMinutes) {
    signals.withinWindow = true
    total += WEIGHTS.withinWindow
  }

  return { intent, score: total, signals, confidence: confidenceFrom(signals) }
}

/** The strongest signal that fired, for the webhook's `match_confidence`. */
export function confidenceFrom(signals: SignalBreakdown): MatchConfidence | null {
  if (signals.referenceExact) return 'exact'
  if (signals.referenceFuzzy) return 'fuzzy'
  if (signals.senderMatch) return 'sender'
  if (signals.activeLock) return 'lock'
  return null
}

/** Scores every candidate and drops the ones below the gate. */
export function scoreAll(
  payment: ObservedPayment,
  candidates: readonly CandidateIntent[],
  options: MatchOptions = {},
): ScoredCandidate[] {
  return candidates
    .map((intent) => score(payment, intent, options))
    .filter((scored) => Number.isFinite(scored.score))
    .sort((a, b) => b.score - a.score)
}
