import { describe, expect, it } from 'vitest'
import {
  isFuzzyRefMatch,
  levenshtein,
  minutesBetween,
  normalizeMsisdn,
  normalizeRef,
  sameMsisdn,
} from './normalize'

describe('normalizeRef', () => {
  it('uppercases and strips everything non-alphanumeric', () => {
    expect(normalizeRef('k7m2')).toBe('K7M2')
    expect(normalizeRef('K7-M2')).toBe('K7M2')
    expect(normalizeRef(' k7 m2 ')).toBe('K7M2')
    expect(normalizeRef('#K7M2!')).toBe('K7M2')
  })

  it('returns null for anything with no alphanumeric content', () => {
    expect(normalizeRef(null)).toBeNull()
    expect(normalizeRef(undefined)).toBeNull()
    expect(normalizeRef('')).toBeNull()
    expect(normalizeRef('   ')).toBeNull()
    expect(normalizeRef('---')).toBeNull()
  })
})

describe('normalizeMsisdn', () => {
  it('reduces every Bangladeshi format to the same ten digits', () => {
    expect(normalizeMsisdn('8801712345678')).toBe('1712345678')
    expect(normalizeMsisdn('01712345678')).toBe('1712345678')
    expect(normalizeMsisdn('+880 1712-345678')).toBe('1712345678')
  })

  it('rejects anything too short to be a number', () => {
    expect(normalizeMsisdn('12345')).toBeNull()
    expect(normalizeMsisdn(null)).toBeNull()
  })
})

describe('sameMsisdn', () => {
  it('matches across formats', () => {
    expect(sameMsisdn('8801712345678', '01712345678')).toBe(true)
  })

  it('treats a missing number as no information, not a match', () => {
    expect(sameMsisdn(null, '01712345678')).toBe(false)
    expect(sameMsisdn(null, null)).toBe(false)
    expect(sameMsisdn('', '')).toBe(false)
  })

  it('rejects different numbers', () => {
    expect(sameMsisdn('8801712345678', '8801812345678')).toBe(false)
  })
})

describe('levenshtein', () => {
  it('computes distance', () => {
    expect(levenshtein('K7M2', 'K7M2')).toBe(0)
    expect(levenshtein('K7M2', 'K7M3')).toBe(1)
    expect(levenshtein('K7M2', 'K7M')).toBe(1)
    expect(levenshtein('K7M2', 'K7XM2')).toBe(1)
    expect(levenshtein('K7M2', 'P2W9')).toBe(4)
  })

  it('stops early once every path exceeds the bound', () => {
    expect(levenshtein('K7M2', 'P2W9', 1)).toBeGreaterThan(1)
    expect(levenshtein('K7M2', 'K7M3', 1)).toBe(1)
  })

  it('handles empty strings', () => {
    expect(levenshtein('', '')).toBe(0)
    expect(levenshtein('K7M2', '')).toBe(4)
  })
})

describe('isFuzzyRefMatch', () => {
  it('accepts exactly one edit and nothing more', () => {
    expect(isFuzzyRefMatch('K7M2', 'K7M3')).toBe(true)
    expect(isFuzzyRefMatch('K7M2', 'K7M2')).toBe(false) // distance 0 is exact, not fuzzy
    expect(isFuzzyRefMatch('K7M2', 'K8M3')).toBe(false)
  })

  it('is false when either side is missing', () => {
    expect(isFuzzyRefMatch(null, 'K7M2')).toBe(false)
    expect(isFuzzyRefMatch('K7M2', null)).toBe(false)
  })
})

describe('minutesBetween', () => {
  it('is unsigned', () => {
    const a = new Date('2026-09-03T14:35:00Z')
    const b = new Date('2026-09-03T14:45:00Z')
    expect(minutesBetween(a, b)).toBe(10)
    expect(minutesBetween(b, a)).toBe(10)
  })
})
