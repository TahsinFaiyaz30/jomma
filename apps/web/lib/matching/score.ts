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
 * These now only *rank* candidates and explain a decision in the queue. What is
 * allowed to match automatically is decided by `admits` below, which is a set of
 * hard requirements rather than a total. Scores that clear a threshold are the
 * wrong tool for "must": 60 + 50 clears 100, and no arrangement of weights can
 * express "the sender has to be the person who said they were paying".
 */
export const WEIGHTS = {
  referenceExact: 100,
  referenceFuzzy: 80,
  senderMatch: 60,
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

/**
 * Why a candidate cannot be matched automatically. `null` means it can.
 *
 * Every one of these sends the payment to the queue with its raw text intact.
 * None of them loses money — they decline to *guess*, which is the only thing
 * that could credit one person's payment to another person's order.
 */
export type Refusal =
  | 'account'
  | 'unparsed'
  | 'amount'
  | 'reference_missing'
  | 'reference_inexact'
  | 'sender_undeclared'
  | 'sender_mismatch'
  | 'before_window'
  | 'after_window'

/**
 * Slack on each end of the payment window.
 *
 * Needed on the lower bound for two unavoidable reasons. bKash writes minutes,
 * not seconds, so a payment made at 14:35:40 reads as 14:35:00 and can look
 * fractionally earlier than a checkout that began at 14:35:20. And the orphan
 * case is real: money sometimes lands a moment *before* the intent commits,
 * which is exactly what the 30-second retry loop exists to pick up.
 *
 * Needed on the upper bound because a payment sent in the last seconds before
 * expiry can carry a timestamp a minute past it.
 *
 * Five minutes absorbs all of that and still refuses a payment from an hour ago.
 */
const WINDOW_GRACE_MS = 5 * 60_000

/**
 * When the payment happened, by the most trustworthy clock available.
 *
 * The message's own timestamp first — it is written by the provider and never
 * changes. The server clock only as a fallback for a message whose date the
 * parser could not read.
 */
function paymentTime(payment: ObservedPayment): Date {
  return payment.occurredAt ?? payment.receivedAt
}

/**
 * The hard requirements for touching money without a human.
 *
 * Three things must all hold, and no amount of corroboration substitutes for
 * any of them:
 *
 * 1. **The account.** Money on the Nagad number cannot settle a bKash intent.
 * 2. **The reference, exactly.** It is the identifier we issue per intent, and
 *    it is unique among open ones. Fuzzy is explicitly not enough: a one
 *    character typo is one buyer's money landing on another buyer's order, and
 *    the person whose money moved has no way to see it. A near miss is not
 *    "nearly right", it is unidentified — it goes to the queue and the buyer
 *    proves it with a TrxID instead.
 * 3. **The sender.** The buyer says which number they will pay from, and the
 *    message says which number paid. If those disagree, or if nobody ever said,
 *    then whoever sent this has not been identified and the payment is not
 *    theirs to credit on evidence this thin.
 * 4. **The time.** It has to have happened between the buyer starting checkout
 *    and the intent expiring, read off the provider's own timestamp.
 *
 * The amount is deliberately *not* one of them. With the reference and the
 * sender both established the payer is identified, and how much they sent is
 * arithmetic: short leaves a balance, over leaves an excess.
 */
export function admits(payment: ObservedPayment, intent: CandidateIntent): Refusal | null {
  if (payment.amountCents === null) return 'unparsed'
  if (payment.amountCents <= 0) return 'amount'
  if (payment.receivingAccountId !== intent.receivingAccountId) return 'account'

  const reference = normalizeRef(payment.referenceRaw)
  const code = normalizeRef(intent.refCode)
  if (!reference || !code) return 'reference_missing'
  if (reference !== code) return 'reference_inexact'

  if (!intent.expectedMsisdn) return 'sender_undeclared'
  if (!sameMsisdn(payment.senderMsisdn, intent.expectedMsisdn)) return 'sender_mismatch'

  /*
   * 4. **The clock.** The payment has to have happened during this checkout.
   *
   * Money that moved before the buyer even opened the page cannot be for this
   * order, and money that moved after it expired is for whatever they did next.
   *
   * Both bounds are real protection rather than tidiness. A buyer who pays the
   * same shop twice in a day has two references live at different times, and
   * the clock is what stops a late-arriving capture for the first landing on
   * the second. Measured against the provider's own message timestamp, not when
   * Jomma saw it, so a phone that was off for an hour still matches correctly.
   */
  const at = paymentTime(payment).getTime()
  if (at < intent.payClickedAt.getTime() - WINDOW_GRACE_MS) return 'before_window'
  if (at > intent.expiresAt.getTime() + WINDOW_GRACE_MS) return 'after_window'

  return null
}

export function amountFit(payment: ObservedPayment, intent: CandidateIntent): AmountFit {
  if (payment.amountCents === null) return 'none'
  if (payment.amountCents <= 0) return 'none'
  if (payment.receivingAccountId !== intent.receivingAccountId) return 'none'
  if (payment.amountCents === intent.outstandingCents) return 'settles'
  return payment.amountCents < intent.outstandingCents ? 'short' : 'over'
}

/** Kept for callers that only need the yes/no. */
export function passesGate(payment: ObservedPayment, intent: CandidateIntent): boolean {
  return admits(payment, intent) === null
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
    withinWindow: false,
  }

  if (admits(payment, intent) !== null) {
    return { intent, score: Number.NEGATIVE_INFINITY, signals, confidence: null }
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
