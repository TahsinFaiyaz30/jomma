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
 * Amount is a gate, not a signal.
 *
 * Below the gate the automatic path never fires, no matter how many other
 * signals line up. Partial and over payments have their own explicit outcomes;
 * they are not "nearly matched".
 *
 * The receiving account is a second gate for the same reason: money that landed
 * on the Nagad number cannot settle an intent addressed to the bKash one.
 */
export function passesGate(payment: ObservedPayment, intent: CandidateIntent): boolean {
  if (payment.amountCents === null) return false
  if (payment.receivingAccountId !== intent.receivingAccountId) return false
  return payment.amountCents === intent.outstandingCents
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

  if (!passesGate(payment, intent)) {
    return {
      intent,
      score: Number.NEGATIVE_INFINITY,
      signals,
      confidence: null,
    }
  }

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
