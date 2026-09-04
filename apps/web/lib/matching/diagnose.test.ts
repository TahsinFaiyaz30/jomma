import { describe, expect, it } from 'vitest'
import { diagnoseCandidates } from './diagnose'
import { ACCOUNT_B, intent, lock, minutesAfter, payment, T0 } from './fixtures'

describe('diagnoseCandidates', () => {
  it('reports the amount delta instead of hiding a gated candidate', () => {
    // Short by ৳200 with only a near-miss reference, so the scorer drops it. A
    // human working the queue still needs to see it and the size of the gap.
    const [first] = diagnoseCandidates(payment({ amountCents: 100_000, referenceRaw: 'K7M3' }), [
      intent({ amountCents: 120_000, refCode: 'K7M2' }),
    ])

    expect(first?.gated).toBe(true)
    expect(first?.gateReason).toBe('amount')
    expect(first?.amountDeltaCents).toBe(-20_000)
    expect(first?.referenceExact).toBe(false)
    expect(first?.score).toBe(Number.NEGATIVE_INFINITY)
  })

  it('does not call a part payment gated when the reference is exact', () => {
    const [first] = diagnoseCandidates(payment({ amountCents: 100_000 }), [
      intent({ amountCents: 120_000, refCode: 'K7M2' }),
    ])

    expect(first?.gated).toBe(false)
    expect(first?.amountDeltaCents).toBe(-20_000)
    expect(first?.referenceExact).toBe(true)
  })

  it('reports the reference edit distance', () => {
    const [first] = diagnoseCandidates(payment({ referenceRaw: 'K7M3' }), [
      intent({ refCode: 'K7M2' }),
    ])
    expect(first?.referenceDistance).toBe(1)
    expect(first?.referenceExact).toBe(false)
  })

  it('flags a sender conflict only when the intent actually declared one', () => {
    const declared = diagnoseCandidates(payment({ senderMsisdn: '8801999999999' }), [
      intent({ expectedMsisdn: '8801712345678' }),
    ])
    expect(declared[0]?.senderConflicts).toBe(true)

    const undeclared = diagnoseCandidates(payment({ senderMsisdn: '8801999999999' }), [
      intent({ expectedMsisdn: null }),
    ])
    expect(undeclared[0]?.senderConflicts).toBe(false)
  })

  it('identifies a wrong-account candidate distinctly from a wrong amount', () => {
    const [first] = diagnoseCandidates(payment(), [intent({ receivingAccountId: ACCOUNT_B })])
    expect(first?.gateReason).toBe('account')
  })

  it('leads with an exact amount even when another candidate scores higher', () => {
    // A: right amount, no reference at all.
    // B: wrong amount, perfect reference — scores -Infinity but looks tempting.
    const results = diagnoseCandidates(payment({ referenceRaw: null, senderMsisdn: null }), [
      intent({ id: 'wrong-amount', amountCents: 500, outstandingCents: 500, refCode: 'K7M2' }),
      intent({ id: 'right-amount', refCode: 'ZZZZ' }),
    ])

    expect(results[0]?.intent.id).toBe('right-amount')
    expect(results[0]?.amountDeltaCents).toBe(0)
  })

  it('ranks by score among candidates that all clear the gate', () => {
    const results = diagnoseCandidates(payment({ referenceRaw: 'K7M2', senderMsisdn: null }), [
      intent({ id: 'weak', refCode: 'ZZZZ' }),
      intent({ id: 'strong', refCode: 'K7M2', lock: lock() }),
    ])

    expect(results[0]?.intent.id).toBe('strong')
    expect(results[0]?.holdsLock).toBe(true)
  })

  it('reports the window without gating on it', () => {
    const [first] = diagnoseCandidates(payment(), [intent({ payClickedAt: minutesAfter(T0, -45) })])
    expect(first?.withinWindow).toBe(false)
    expect(first?.minutesApart).toBe(45)
  })

  it('marks an unparsed payment rather than pretending the amount is zero', () => {
    const [first] = diagnoseCandidates(payment({ amountCents: null }), [intent()])
    expect(first?.gateReason).toBe('unparsed')
    expect(first?.amountDeltaCents).toBeNull()
  })
})
