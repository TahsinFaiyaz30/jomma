export type { CandidateDiagnosis } from './diagnose'
export { diagnoseCandidates } from './diagnose'
export {
  isFuzzyRefMatch,
  levenshtein,
  minutesBetween,
  normalizeMsisdn,
  normalizeRef,
  sameMsisdn,
} from './normalize'
export {
  DEFAULT_AMBIGUITY_MARGIN,
  DEFAULT_APPROVE_THRESHOLD,
  isAutoApprovable,
  resolveMatch,
} from './resolve'
export {
  confidenceFrom,
  passesGate,
  score,
  scoreAll,
  WEIGHTS,
} from './score'
export type {
  CandidateIntent,
  MatchOptions,
  MatchResult,
  ObservedPayment,
  ScoredCandidate,
  SignalBreakdown,
} from './types'
