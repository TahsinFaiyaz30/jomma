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
  holdsActiveLock,
  passesGate,
  score,
  scoreAll,
  WEIGHTS,
} from './score'
export type {
  CandidateIntent,
  CandidateLock,
  MatchOptions,
  MatchResult,
  ObservedPayment,
  ScoredCandidate,
  SignalBreakdown,
} from './types'
