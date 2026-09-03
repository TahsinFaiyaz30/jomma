import { levenshtein, minutesBetween, normalizeRef, sameMsisdn } from './normalize'
import { DEFAULT_WINDOW_MINUTES, holdsActiveLock, passesGate, score } from './score'
import type { CandidateIntent, MatchOptions, ObservedPayment } from './types'

/**
 * Why a candidate did or did not win.
 *
 * The scorer answers "which intent, if any" and deliberately says nothing about
 * near-misses — a candidate that fails the amount gate scores -Infinity and
 * disappears. That is right for the automatic path and useless for a human
 * working the queue, who needs to see *how* close each one was in order to
 * decide.
 *
 * So this runs the same signals with the gate lifted and reports the
 * discrepancies. It never approves anything; it only explains.
 */

export interface CandidateDiagnosis {
  intent: CandidateIntent
  /** Payment amount minus what this intent still expects. 0 means exact. */
  amountDeltaCents: number | null
  /** Edit distance between the typed reference and this intent's code. */
  referenceDistance: number | null
  referenceExact: boolean
  senderMatches: boolean
  /** Sender was declared on the intent but does not match what arrived. */
  senderConflicts: boolean
  holdsLock: boolean
  minutesApart: number
  withinWindow: boolean
  /** The real score, -Infinity when gated — what the automatic path saw. */
  score: number
  /** True when the amount or the account ruled it out. */
  gated: boolean
  gateReason: 'amount' | 'account' | 'unparsed' | null
}

export function diagnoseCandidates(
  payment: ObservedPayment,
  candidates: readonly CandidateIntent[],
  options: MatchOptions = {},
): CandidateDiagnosis[] {
  const windowMinutes = options.windowMinutes ?? DEFAULT_WINDOW_MINUTES
  const reference = normalizeRef(payment.referenceRaw)

  const diagnoses = candidates.map((intent): CandidateDiagnosis => {
    const code = normalizeRef(intent.refCode)
    const referenceDistance = reference && code ? levenshtein(reference, code, 4) : null

    const senderMatches = sameMsisdn(payment.senderMsisdn, intent.expectedMsisdn)
    const minutesApart = minutesBetween(intent.payClickedAt, payment.receivedAt)

    const gateReason: CandidateDiagnosis['gateReason'] =
      payment.amountCents === null
        ? 'unparsed'
        : payment.receivingAccountId !== intent.receivingAccountId
          ? 'account'
          : payment.amountCents !== intent.outstandingCents
            ? 'amount'
            : null

    return {
      intent,
      amountDeltaCents:
        payment.amountCents === null ? null : payment.amountCents - intent.outstandingCents,
      referenceDistance,
      referenceExact: referenceDistance === 0,
      senderMatches,
      // An intent that named a payer, where somebody else paid. Worth showing —
      // it is approvable, but it is the pattern you want to notice repeating.
      senderConflicts:
        !senderMatches && Boolean(intent.expectedMsisdn) && Boolean(payment.senderMsisdn),
      holdsLock: holdsActiveLock(payment, intent),
      minutesApart,
      withinWindow: minutesApart <= windowMinutes,
      score: score(payment, intent, options).score,
      gated: !passesGate(payment, intent),
      gateReason,
    }
  })

  /*
   * Most plausible first, which is not the same as highest scoring: an exact
   * amount with a wrong reference is far more likely to be the right order than
   * a right reference at the wrong amount, and the queue should lead with it.
   */
  return diagnoses.sort((a, b) => {
    const exactA = a.amountDeltaCents === 0 ? 1 : 0
    const exactB = b.amountDeltaCents === 0 ? 1 : 0
    if (exactA !== exactB) return exactB - exactA

    if (Number.isFinite(a.score) || Number.isFinite(b.score)) {
      const scoreA = Number.isFinite(a.score) ? a.score : -1
      const scoreB = Number.isFinite(b.score) ? b.score : -1
      if (scoreA !== scoreB) return scoreB - scoreA
    }

    const distA = a.referenceDistance ?? 99
    const distB = b.referenceDistance ?? 99
    if (distA !== distB) return distA - distB

    return Math.abs(a.amountDeltaCents ?? 0) - Math.abs(b.amountDeltaCents ?? 0)
  })
}
