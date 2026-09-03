import { scoreAll } from './score'
import type { CandidateIntent, MatchOptions, MatchResult, ObservedPayment } from './types'

export const DEFAULT_APPROVE_THRESHOLD = 100
export const DEFAULT_AMBIGUITY_MARGIN = 60

/**
 * The whole decision, in one pure function.
 *
 * The rule that matters most is the one it refuses to break: **never guess
 * between two candidates**. If two intents both clear the threshold and are
 * close, this returns `ambiguous` and a human decides. Ambiguity is escalated,
 * never resolved by ranking.
 */
export function resolveMatch(
  payment: ObservedPayment,
  candidates: readonly CandidateIntent[],
  options: MatchOptions = {},
): MatchResult {
  const approveThreshold = options.approveThreshold ?? DEFAULT_APPROVE_THRESHOLD
  const ambiguityMargin = options.ambiguityMargin ?? DEFAULT_AMBIGUITY_MARGIN

  // A message the parser could not read has no amount, so it cannot clear the
  // gate and must not be silently dropped — it goes to a human.
  if (payment.amountCents === null) {
    return { kind: 'unmatched', reason: 'unparsed' }
  }

  if (candidates.length === 0) {
    return { kind: 'unmatched', reason: 'no_candidates' }
  }

  const scored = scoreAll(payment, candidates, options)

  if (scored.length === 0) {
    // Candidates existed but every one failed the amount or account gate. Money
    // arrived and nothing claims it.
    return { kind: 'unmatched', reason: 'amount_gate' }
  }

  // An agent cash-in, or a type the parser flagged as `other`, never
  // auto-approves however well it scores. docs/matching.md outcome 8.
  if (payment.transactionType !== null && payment.transactionType !== 'send_money') {
    return {
      kind: 'ambiguous',
      reason: 'wrong_transaction_type',
      candidates: scored,
    }
  }

  const top = scored[0]
  if (!top) return { kind: 'unmatched', reason: 'amount_gate' }

  const runnerUp = scored[1] ?? null

  if (top.score < approveThreshold) {
    return { kind: 'ambiguous', reason: 'below_threshold', candidates: scored }
  }

  if (!runnerUp || runnerUp.score < approveThreshold) {
    return {
      kind: 'matched',
      candidate: top,
      runnerUp,
      margin: runnerUp ? top.score - runnerUp.score : null,
    }
  }

  const margin = top.score - runnerUp.score
  if (margin >= ambiguityMargin) {
    return { kind: 'matched', candidate: top, runnerUp, margin }
  }

  return {
    kind: 'ambiguous',
    reason: 'multiple_above_threshold',
    candidates: scored,
  }
}

/** Convenience for call sites that only branch on approved / not approved. */
export function isAutoApprovable(
  result: MatchResult,
): result is Extract<MatchResult, { kind: 'matched' }> {
  return result.kind === 'matched'
}
