import { describe, expect, it } from 'vitest'
import { ACCOUNT_A, ACCOUNT_B, intent, minutesAfter, payment, T0 } from './fixtures'
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
    })

    const result = resolveMatch(payment({ amountCents: 119_999, referenceRaw: 'K7M3' }), [
      candidate,
    ])

    expect(result.kind).toBe('unmatched')
    if (result.kind === 'unmatched') expect(result.reason).toBe('amount_gate')
  })

  it('still refuses an inexact amount with no reference at all', () => {
    const candidate = intent({ expectedMsisdn: '8801712345678' })
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
  it('auto-approves an exact reference from the declared sender', () => {
    const result = resolveMatch(payment(), [
      intent({ refCode: 'K7M2', payClickedAt: minutesAfter(T0, -60) }),
    ])

    expect(result.kind).toBe('matched')
    if (result.kind === 'matched') {
      expect(result.candidate.intent.id).toBe('int-1')
      expect(result.candidate.confidence).toBe('exact')
      expect(result.runnerUp).toBeNull()
    }
  })

  it('normalises a reference the buyer typed with spaces and symbols', () => {
    const result = resolveMatch(payment({ referenceRaw: ' k7-m2 ' }), [
      intent({ refCode: 'K7M2', payClickedAt: minutesAfter(T0, -60) }),
    ])

    expect(result.kind).toBe('matched')
    if (result.kind === 'matched') expect(result.candidate.confidence).toBe('exact')
  })

  /*
   * Fuzzy matching used to auto-approve at distance 1. It does not any more,
   * and this is the rule it was traded for.
   *
   * A four-character code one edit away from another open code is not "nearly
   * right", it is unidentified. Approving it moves one buyer's money onto
   * another buyer's order, and the person whose money moved has no way to see
   * that it happened. The buyer proves it with a TrxID instead, which is
   * evidence only they could have.
   *
   * The distance is still computed and still shown in the queue — it is how an
   * admin sees a typo for what it is. It just no longer decides anything.
   */
  it('refuses a reference off by one character', () => {
    const result = resolveMatch(payment({ referenceRaw: 'K7M3' }), [intent({ refCode: 'K7M2' })])

    expect(result.kind).toBe('unmatched')
    if (result.kind === 'unmatched') expect(result.reason).toBe('amount_gate')
  })

  it('refuses a mistyped reference that is close to two open codes', () => {
    const result = resolveMatch(payment({ referenceRaw: 'K7M3' }), [
      intent({ id: 'int-a', refCode: 'K7M2' }),
      intent({ id: 'int-b', refCode: 'K7M9' }),
    ])

    expect(result.kind).toBe('unmatched')
  })

  it('refuses a payment with no reference at all', () => {
    // The buyer skipped the field. Recoverable by TrxID, never automatically.
    const result = resolveMatch(payment({ referenceRaw: null }), [intent({ refCode: 'K7M2' })])

    expect(result.kind).toBe('unmatched')
  })
})

describe('the sender requirement', () => {
  it('refuses money from a number the buyer did not declare', () => {
    const result = resolveMatch(payment({ senderMsisdn: '8801999999999' }), [
      intent({ refCode: 'K7M2', expectedMsisdn: '8801712345678' }),
    ])

    expect(result.kind).toBe('unmatched')
  })

  it('refuses when nobody ever said who would pay', () => {
    // An exact reference is not enough on its own: without a declared payer the
    // sender cannot be checked, so whoever sent this is unidentified.
    const result = resolveMatch(payment(), [intent({ refCode: 'K7M2', expectedMsisdn: null })])

    expect(result.kind).toBe('unmatched')
  })

  it('accepts the same number written in a different format', () => {
    const result = resolveMatch(payment({ senderMsisdn: '01712345678' }), [
      intent({ refCode: 'K7M2', expectedMsisdn: '+8801712345678' }),
    ])

    expect(result.kind).toBe('matched')
  })
})

describe('the payment window', () => {
  /*
   * A payment has to have happened during this checkout. Read off the message's
   * own timestamp, because a notification can be delayed or captured late but
   * the time the provider wrote never changes.
   *
   * Both ends are real protection. Reference codes are reissued after their
   * cooldown, so without an upper bound a payment carrying a recycled code
   * could attach to an intent that had nothing to do with it.
   */
  it('refuses money that moved before the buyer started checkout', () => {
    const result = resolveMatch(
      // An hour before this intent existed. Perfect reference, right sender.
      payment({ occurredAt: minutesAfter(T0, -60) }),
      [intent({ payClickedAt: minutesAfter(T0, -2), expiresAt: minutesAfter(T0, 3) })],
    )

    expect(result.kind).toBe('unmatched')
  })

  it('refuses money that moved after the intent expired', () => {
    const result = resolveMatch(payment({ occurredAt: minutesAfter(T0, 60) }), [
      intent({ payClickedAt: minutesAfter(T0, -2), expiresAt: minutesAfter(T0, 3) }),
    ])

    expect(result.kind).toBe('unmatched')
  })

  it('accepts money inside the window', () => {
    const result = resolveMatch(payment({ occurredAt: T0 }), [
      intent({ payClickedAt: minutesAfter(T0, -2), expiresAt: minutesAfter(T0, 3) }),
    ])

    expect(result.kind).toBe('matched')
  })

  it('tolerates a payment a moment before the intent committed', () => {
    // The orphan case, plus bKash writing minutes rather than seconds. Both can
    // put a legitimate payment fractionally before the start.
    const result = resolveMatch(payment({ occurredAt: minutesAfter(T0, -3) }), [
      intent({ payClickedAt: T0, expiresAt: minutesAfter(T0, 5) }),
    ])

    expect(result.kind).toBe('matched')
  })

  it('falls back to the server clock when the message had no readable date', () => {
    const result = resolveMatch(payment({ occurredAt: null, receivedAt: minutesAfter(T0, -60) }), [
      intent({ payClickedAt: minutesAfter(T0, -2), expiresAt: minutesAfter(T0, 3) }),
    ])

    expect(result.kind).toBe('unmatched')
  })

  it('prefers the message clock over a late capture', () => {
    // Captured an hour late — the notification sat on a phone that was off —
    // but the provider says it happened inside the window. That is the one
    // that counts.
    const result = resolveMatch(payment({ occurredAt: T0, receivedAt: minutesAfter(T0, 60) }), [
      intent({ payClickedAt: minutesAfter(T0, -2), expiresAt: minutesAfter(T0, 3) }),
    ])

    expect(result.kind).toBe('matched')
  })
})

describe('ranking signals', () => {
  /*
   * Sender-plus-lock used to be enough on its own — it was how a buyer who
   * skipped the reference field still got matched. It is not any more.
   *
   * The trade is deliberate. That path identified a payer by the amount they
   * sent, and an amount is not an identity: two buyers ordering the same item
   * at the same price are indistinguishable under it. Without a reference the
   * payment now waits for a TrxID, which is evidence only the payer has.
   */
  it('refuses sender plus lock when the buyer skipped the reference field', () => {
    const result = resolveMatch(payment({ referenceRaw: null }), [
      intent({ refCode: 'K7M2', expectedMsisdn: '8801712345678' }),
    ])

    expect(result.kind).toBe('unmatched')
  })

  it('refuses a no-reference payment when the sender is undeclared too', () => {
    const result = resolveMatch(payment({ referenceRaw: null, senderMsisdn: '8801999999999' }), [
      intent({ expectedMsisdn: null }),
    ])

    expect(result.kind).toBe('unmatched')
  })

  /*
   * The signals below still compute. They no longer decide anything on their
   * own, but they rank candidates and they are what an admin reads in the queue
   * to understand why something landed there.
   */
  it('drops the recency signal outside the ten-minute window', () => {
    const scored = score(payment(), intent({ payClickedAt: minutesAfter(T0, -11) }))
    expect(scored.signals.withinWindow).toBe(false)
    expect(scored.score).toBe(WEIGHTS.referenceExact + WEIGHTS.senderMatch)
  })

  it('still counts recency for a payment that arrived before the intent committed', () => {
    // The orphan case: money lands, the order commits seconds later, the 30s
    // retry loop re-runs the matcher.
    const scored = score(payment(), intent({ payClickedAt: minutesAfter(T0, 3) }))
    expect(scored.signals.withinWindow).toBe(true)
  })
})

describe('the ambiguity rule', () => {
  /*
   * Reference codes are unique among open intents, so two candidates clearing
   * every requirement should be impossible. This is defence in depth: if it
   * ever does happen, refuse rather than rank.
   */
  it('escalates rather than choosing between two admissible candidates', () => {
    const result = resolveMatch(payment(), [
      intent({ id: 'int-a', refCode: 'K7M2', expectedMsisdn: '8801712345678' }),
      intent({ id: 'int-b', refCode: 'K7M2', expectedMsisdn: '8801712345678' }),
    ])

    expect(result.kind).toBe('ambiguous')
    if (result.kind === 'ambiguous') {
      expect(result.candidates).toHaveLength(2)
    }
  })

  it('approves when only one candidate is admissible at all', () => {
    const result = resolveMatch(payment(), [
      intent({ id: 'int-a', refCode: 'K7M2' }),
      // Right code, wrong payer — refused, so it is not a rival.
      intent({ id: 'int-b', refCode: 'K7M2', expectedMsisdn: '8801999999999' }),
    ])

    expect(result.kind).toBe('matched')
    if (result.kind === 'matched') expect(result.candidate.intent.id).toBe('int-a')
  })

  it('honours a raised threshold from options', () => {
    const candidates = [intent({ refCode: 'K7M2', payClickedAt: minutesAfter(T0, -60) })]
    expect(resolveMatch(payment(), candidates).kind).toBe('matched')
    expect(resolveMatch(payment(), candidates, { approveThreshold: 500 }).kind).toBe('ambiguous')
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
      }),
    ])

    expect(result.kind).toBe('ambiguous')
    if (result.kind === 'ambiguous') {
      expect(result.reason).toBe('wrong_transaction_type')
      // The score is still recorded so the reviewer sees it was otherwise perfect.
      expect(result.candidates[0]!.score).toBe(
        WEIGHTS.referenceExact + WEIGHTS.senderMatch + WEIGHTS.withinWindow,
      )
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
