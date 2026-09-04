import type { CandidateIntent, CandidateLock, ObservedPayment } from './types'

/**
 * Builders for the matcher suite. Kept out of the test files so the synthetic
 * collision cases read as scenarios rather than object literals.
 *
 * The defaults describe a payment that *should* match: right account, exact
 * reference, and a sender the intent declared. Tests then break one thing at a
 * time, which is the only way to be sure which requirement a refusal came from.
 */

export const ACCOUNT_A = 'acct-a'
export const ACCOUNT_B = 'acct-b'

export const T0 = new Date('2026-09-03T14:35:00Z')

export function minutesAfter(base: Date, minutes: number): Date {
  return new Date(base.getTime() + minutes * 60_000)
}

export function payment(overrides: Partial<ObservedPayment> = {}): ObservedPayment {
  return {
    id: 'pay-1',
    receivingAccountId: ACCOUNT_A,
    amountCents: 120_000,
    senderMsisdn: '8801712345678',
    referenceRaw: 'K7M2',
    transactionType: 'send_money',
    receivedAt: T0,
    ...overrides,
  }
}

export function lock(overrides: Partial<CandidateLock> = {}): CandidateLock {
  return {
    id: 'lock-1',
    receivingAccountId: ACCOUNT_A,
    amountCents: 120_000,
    status: 'active',
    expiresAt: minutesAfter(T0, 5),
    ...overrides,
  }
}

export function intent(overrides: Partial<CandidateIntent> = {}): CandidateIntent {
  const amountCents = overrides.amountCents ?? 120_000
  return {
    id: 'int-1',
    receivingAccountId: ACCOUNT_A,
    amountCents,
    outstandingCents: overrides.outstandingCents ?? amountCents,
    refCode: 'K7M2',
    // Declared by default. The buyer naming their number is required for an
    // automatic match, so an intent without one is the exception, not the norm.
    expectedMsisdn: '8801712345678',
    payClickedAt: minutesAfter(T0, -2),
    expiresAt: minutesAfter(T0, 3),
    status: 'open',
    lock: null,
    ...overrides,
  }
}
