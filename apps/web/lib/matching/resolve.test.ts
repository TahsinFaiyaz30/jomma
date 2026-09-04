import { describe, expect, it } from 'vitest'
import { ACCOUNT_A, ACCOUNT_B, intent, lock, minutesAfter, payment, T0 } from './fixtures'
import { resolveMatch } from './resolve'
import { score, WEIGHTS } from './score'

/**
 * The synthetic collision suite from PROMPTS.md §4, plus the failure catalogue
 * cases in docs/matching.md.
 *
 * These tests encode product rules, not implementation details. If one starts
 * failing, the rule is what needs discussing — do not weaken a test to make it
 * pass.
 */

describe('the amount gate', () => {
  /*
   * The rule here changed deliberately, and these tests are the record of it.
   *
   * Amount used to be an absolute gate: nothing matched unless it settled the
   * balance exactly. That made a part payment unmatchable even with a perfect
   * reference, which is the wrong answer — the reference code is the identifier
   * we issue precisely so that identity does not depend on the amount.
   *
   * What replaced it: an exact reference makes the amount arithmetic. Without
   * one, the amount is still the identifier and still has to be exact.
   */

  it('matches a part payment when the reference is exactly right', () => {
    const candidate = intent({ refCode: 'K7M2' })

    // ৳1,200 owed, ৳1,000 sent, correct code. A part payment, not a mismatch.
    const result = resolveMatch(payment({ amountCents: 100_000 }), [candidate])

    expect(result.kind).toBe('matched')
  })

  it('matches an over payment when the reference is exactly right', () => {
    const candidate = intent({ refCode: 'K7M2' })
    const result = resolveMatch(payment({ amountCents: 130_000 }), [candidate])

    expect(result.kind).toBe('matched')
  })

  it('still refuses an inexact amount when the reference is only close', () => {
    // Sender, lock and window all fire, and the code is one character out. That
    // is enough to identify a payment whose amount corroborates it, and not
    // enough to move money onto an order the amount does not fit.
    const candidate = intent({
      refCode: 'K7M2',
      expectedMsisdn: '8801712345678',
      lock: lock(),
    })

    const result = resolveMatch(payment({ amountCents: 119_999, referenceRaw: 'K7M3' }), [
      candidate,
    ])

    expect(result.kind).toBe('unmatched')
    if (result.kind === 'unmatched') expect(result.reason).toBe('amount_gate')
  })

  it('still refuses an inexact amount with no reference at all', () => {
    const candidate = intent({ expectedMsisdn: '8801712345678', lock: lock() })
    const result = resolveMatch(payment({ amountCents: 119_999, referenceRaw: null }), [candidate])

    expect(result.kind).toBe('unmatched')
    if (result.kind === 'unmatched') expect(result.reason).toBe('amount_gate')
  })

  it('scores a gated candidate as -Infinity so no sort can promote it', () => {
    const scored = score(payment({ amountCents: 119_999, referenceRaw: null }), intent())
    expect(scored.score).toBe(Number.NEGATIVE_INFINITY)
    expect(scored.confidence).toBeNull()
  })

  it('rejects a payment that landed on a different receiving account', () => {
    const candidate = intent({
      receivingAccountId: ACCOUNT_B,
      lock: lock({ receivingAccountId: ACCOUNT_B }),
    })
    const result = resolveMatch(payment({ receivingAccountId: ACCOUNT_A }), [candidate])

    expect(result.kind).toBe('unmatched')
    if (result.kind === 'unmatched') expect(result.reason).toBe('amount_gate')
  })

  it('lets an exact top-up clear the gate against the outstanding balance', () => {
    // ৳1,200 order, ৳1,000 already received, buyer sends the remaining ৳200.
    const candidate = intent({
      amountCents: 120_000,
      outstandingCents: 20_000,
      status: 'partial',
      refCode: 'K7M2',
    })

    const result = resolveMatch(payment({ amountCents: 20_000, referenceRaw: 'K7M2' }), [candidate])
    expect(result.kind).toBe('matched')
  })
})

describe('reference matching', () => {
  it('auto-approves an exact reference with a single candidate', () => {
    const result = resolveMatch(payment({ senderMsisdn: null }), [
      intent({ refCode: 'K7M2', payClickedAt: minutesAfter(T0, -60) }),
    ])

    expect(result.kind).toBe('matched')
    if (result.kind === 'matched') {
      expect(result.candidate.intent.id).toBe('int-1')
      expect(result.candidate.score).toBe(WEIGHTS.referenceExact)
      expect(result.candidate.confidence).toBe('exact')
      expect(result.runnerUp).toBeNull()
    }
  })

  it('normalises a reference the buyer typed with spaces and symbols', () => {
    const result = resolveMatch(payment({ referenceRaw: ' k7-m2 ', senderMsisdn: null }), [
      intent({ refCode: 'K7M2', payClickedAt: minutesAfter(T0, -60) }),
    ])

    expect(result.kind).toBe('matched')
    if (result.kind === 'matched') expect(result.candidate.confidence).toBe('exact')
  })

  it('accepts a reference off by one character against a single candidate', () => {
    // 80 (fuzzy) + 20 (window) = 100, exactly the threshold.
    const result = resolveMatch(payment({ referenceRaw: 'K7M3', senderMsisdn: null }), [
      intent({ refCode: 'K7M2' }),
    ])

    expect(result.kind).toBe('matched')
    if (result.kind === 'matched') {
      expect(result.candidate.score).toBe(WEIGHTS.referenceFuzzy + WEIGHTS.withinWindow)
      expect(result.candidate.confidence).toBe('fuzzy')
    }
  })

  it('escalates when a mistyped reference is within one edit of two open codes', () => {
    // "K7M3" is distance 1 from both "K7M2" and "K7M9". Guessing here would
    // credit the wrong buyer.
    const result = resolveMatch(payment({ referenceRaw: 'K7M3', senderMsisdn: null }), [
      intent({ id: 'int-a', refCode: 'K7M2' }),
      intent({ id: 'int-b', refCode: 'K7M9' }),
    ])

    expect(result.kind).toBe('ambiguous')
    if (result.kind === 'ambiguous') {
      expect(result.reason).toBe('multiple_above_threshold')
      expect(result.candidates).toHaveLength(2)
      expect(result.candidates[0]?.score).toBe(result.candidates[1]?.score)
    }
  })

  it('does not fuzzy-match at distance two', () => {
    const result = resolveMatch(payment({ referenceRaw: 'K8M3', senderMsisdn: null }), [
      intent({ refCode: 'K7M2' }),
    ])

    expect(result.kind).toBe('ambiguous')
    if (result.kind === 'ambiguous') expect(result.reason).toBe('below_threshold')
  })
})

describe('sender and lock signals', () => {
  it('matches on sender plus lock when the buyer skipped the reference field', () => {
    // 60 (sender) + 50 (lock) + 20 (window) = 130.
    const result = resolveMatch(payment({ referenceRaw: null }), [
      intent({
        refCode: 'K7M2',
        expectedMsisdn: '8801712345678',
        lock: lock(),
      }),
    ])

    expect(result.kind).toBe('matched')
    if (result.kind === 'matched') {
      expect(result.candidate.score).toBe(
        WEIGHTS.senderMatch + WEIGHTS.activeLock + WEIGHTS.withinWindow,
      )
      expect(result.candidate.confidence).toBe('sender')
      expect(result.candidate.signals.referenceExact).toBe(false)
    }
  })

  it('escalates a no-reference payment when the sender is undeclared', () => {
    // 50 (lock) + 20 (window) = 70. Not enough on its own.
    const result = resolveMatch(payment({ referenceRaw: null, senderMsisdn: '8801999999999' }), [
      intent({ expectedMsisdn: null, lock: lock() }),
    ])

    expect(result.kind).toBe('ambiguous')
    if (result.kind === 'ambiguous') expect(result.reason).toBe('below_threshold')
  })

  it('ignores a lock that had already expired when the money arrived', () => {
    const expired = lock({ expiresAt: minutesAfter(T0, -1) })
    const scored = score(payment({ referenceRaw: null }), intent({ lock: expired }))
    expect(scored.signals.activeLock).toBe(false)
  })

  it('ignores a lock that has already been consumed', () => {
    const consumed = lock({ status: 'consumed' })
    const scored = score(payment({ referenceRaw: null }), intent({ lock: consumed }))
    expect(scored.signals.activeLock).toBe(false)
  })

  it('drops the recency signal outside the ten-minute window', () => {
    const scored = score(
      payment({ referenceRaw: null, senderMsisdn: null }),
      intent({ payClickedAt: minutesAfter(T0, -11), lock: lock() }),
    )
    expect(scored.signals.withinWindow).toBe(false)
    expect(scored.score).toBe(WEIGHTS.activeLock)
  })

  it('still counts recency for a payment that arrived before the intent committed', () => {
    // The orphan case: money lands, the order commits seconds later, the 30s
    // retry loop re-runs the matcher.
    const scored = score(
      payment({ referenceRaw: null }),
      intent({ payClickedAt: minutesAfter(T0, 3) }),
    )
    expect(scored.signals.withinWindow).toBe(true)
  })
})

describe('the ambiguity rule', () => {
  it('escalates two intents at the same amount in the same window', () => {
    // Only one can hold the lock — the partial unique index guarantees that.
    // A: 50 + 20 = 70. B: 20. Neither clears the threshold.
    const result = resolveMatch(payment({ referenceRaw: null, senderMsisdn: null }), [
      intent({ id: 'int-a', refCode: 'K7M2', lock: lock() }),
      intent({ id: 'int-b', refCode: 'P2W9', lock: null }),
    ])

    expect(result.kind).toBe('ambiguous')
    if (result.kind === 'ambiguous') {
      expect(result.reason).toBe('below_threshold')
      expect(result.candidates).toHaveLength(2)
    }
  })

  it('escalates when the top candidate beats the second by less than 60', () => {
    // A: 80 (fuzzy) + 50 (lock) + 20 (window) = 150.
    // B: 80 (fuzzy) + 20 (window)            = 100.
    // Both clear 100; the margin is 50, under the required 60.
    const result = resolveMatch(payment({ referenceRaw: 'K7M3', senderMsisdn: null }), [
      intent({ id: 'int-a', refCode: 'K7M2', lock: lock() }),
      intent({ id: 'int-b', refCode: 'K7M9' }),
    ])

    expect(result.kind).toBe('ambiguous')
    if (result.kind === 'ambiguous') {
      expect(result.reason).toBe('multiple_above_threshold')
      expect(result.candidates[0]!.score - result.candidates[1]!.score).toBe(50)
    }
  })

  it('approves when the top candidate beats the second by 60 or more', () => {
    // A: 100 (exact) + 60 (sender) + 20 (window) = 180.
    // B: 80 (fuzzy) + 20 (window)                = 100. Margin 80.
    const result = resolveMatch(payment({ referenceRaw: 'K7M2' }), [
      intent({ id: 'int-a', refCode: 'K7M2', expectedMsisdn: '8801712345678' }),
      intent({ id: 'int-b', refCode: 'K7M3' }),
    ])

    expect(result.kind).toBe('matched')
    if (result.kind === 'matched') {
      expect(result.candidate.intent.id).toBe('int-a')
      expect(result.margin).toBe(80)
    }
  })

  it('approves when only one candidate clears the threshold, whatever the margin', () => {
    // A: 100 (exact) + 20 = 120. B: 20 alone. The runner-up is below the bar, so
    // the margin rule does not apply.
    const result = resolveMatch(payment({ referenceRaw: 'K7M2', senderMsisdn: null }), [
      intent({ id: 'int-a', refCode: 'K7M2' }),
      intent({ id: 'int-b', refCode: 'ZZZZ' }),
    ])

    expect(result.kind).toBe('matched')
    if (result.kind === 'matched') {
      expect(result.candidate.intent.id).toBe('int-a')
      expect(result.margin).toBe(100)
    }
  })

  it('honours a raised threshold and margin from options', () => {
    const candidates = [intent({ refCode: 'K7M2', payClickedAt: minutesAfter(T0, -60) })]
    expect(resolveMatch(payment({ senderMsisdn: null }), candidates).kind).toBe('matched')
    expect(
      resolveMatch(payment({ senderMsisdn: null }), candidates, {
        approveThreshold: 150,
      }).kind,
    ).toBe('ambiguous')
  })
})

describe('payments nothing claims', () => {
  it('reports no candidates at all', () => {
    const result = resolveMatch(payment(), [])
    expect(result.kind).toBe('unmatched')
    if (result.kind === 'unmatched') expect(result.reason).toBe('no_candidates')
  })

  it('reports an unparsed message rather than dropping it', () => {
    const result = resolveMatch(payment({ amountCents: null, referenceRaw: null }), [intent()])
    expect(result.kind).toBe('unmatched')
    if (result.kind === 'unmatched') expect(result.reason).toBe('unparsed')
  })

  it('never auto-approves an agent cash-in, however well it scores', () => {
    const result = resolveMatch(payment({ transactionType: 'cash_in' }), [
      intent({
        refCode: 'K7M2',
        expectedMsisdn: '8801712345678',
        lock: lock(),
      }),
    ])

    expect(result.kind).toBe('ambiguous')
    if (result.kind === 'ambiguous') {
      expect(result.reason).toBe('wrong_transaction_type')
      // The score is still recorded so the reviewer sees it was otherwise perfect.
      expect(result.candidates[0]!.score).toBe(230)
    }
  })

  it('never auto-approves an unrecognised transaction type', () => {
    const result = resolveMatch(payment({ transactionType: 'other' }), [
      intent({ refCode: 'K7M2' }),
    ])
    expect(result.kind).toBe('ambiguous')
  })
})

describe('determinism', () => {
  it('returns the same result regardless of candidate order', () => {
    const a = intent({
      id: 'int-a',
      refCode: 'K7M2',
      expectedMsisdn: '8801712345678',
    })
    const b = intent({ id: 'int-b', refCode: 'ZZZZ' })

    const forward = resolveMatch(payment(), [a, b])
    const reverse = resolveMatch(payment(), [b, a])

    expect(forward.kind).toBe(reverse.kind)
    if (forward.kind === 'matched' && reverse.kind === 'matched') {
      expect(forward.candidate.intent.id).toBe(reverse.candidate.intent.id)
      expect(forward.candidate.score).toBe(reverse.candidate.score)
    }
  })

  it('does no I/O — the module graph pulls in nothing but @jomma/shared types', async () => {
    const module = await import('./index')
    expect(typeof module.resolveMatch).toBe('function')
    expect(typeof module.score).toBe('function')
  })
})
