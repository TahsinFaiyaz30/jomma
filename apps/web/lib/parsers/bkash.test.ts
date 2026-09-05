import { describe, expect, it } from 'vitest'
import { parseBkash } from './bkash'
import { BKASH_FIXTURES } from './fixtures/bkash'
import { parseMessage } from './index'
import { parseNagad } from './nagad'
import { takaToPoisha, toE164 } from './types'

describe('takaToPoisha', () => {
  it('converts without losing a poisha to floating point', () => {
    expect(takaToPoisha('1,200.00')).toBe(120_000)
    expect(takaToPoisha('1200')).toBe(120_000)
    expect(takaToPoisha('0.07')).toBe(7)
    // parseFloat('1200.07') * 100 is 120006.99999999999 — truncating loses one.
    expect(takaToPoisha('1200.07')).toBe(120_007)
    expect(takaToPoisha('45,320.00')).toBe(4_532_000)
  })

  it('rejects anything that is not a plain amount', () => {
    expect(takaToPoisha('abc')).toBeNull()
    expect(takaToPoisha('12.345')).toBeNull()
    expect(takaToPoisha('')).toBeNull()
  })
})

describe('toE164', () => {
  it('normalises every local format to 880…', () => {
    expect(toE164('01712345678')).toBe('8801712345678')
    expect(toE164('8801712345678')).toBe('8801712345678')
    expect(toE164('+880 1712-345678')).toBe('8801712345678')
    expect(toE164('123')).toBeNull()
    expect(toE164(null)).toBeNull()
  })
})

/**
 * By name, not by index. Fixtures get reordered — a live capture landing at the
 * top of the list should not silently repoint an unrelated assertion.
 */
function fixture(name: string) {
  const found = BKASH_FIXTURES.find((entry) => entry.name.includes(name))
  if (!found) throw new Error(`No bKash fixture matching "${name}"`)
  return found
}

describe('bKash parser', () => {
  for (const entry of BKASH_FIXTURES) {
    it(entry.name, () => {
      const parsed = parseBkash(entry.raw)
      expect(parsed.trxId).toBe(entry.expect.trxId)
      expect(parsed.amountCents).toBe(entry.expect.amountCents)
      expect(parsed.senderMsisdn).toBe(entry.expect.senderMsisdn)
      expect(parsed.referenceRaw).toBe(entry.expect.referenceRaw)
      expect(parsed.balanceAfterCents).toBe(entry.expect.balanceAfterCents)
      expect(parsed.transactionType).toBe(entry.expect.transactionType)
      expect(parsed.parseStatus).toBe(entry.expect.parseStatus)
    })
  }

  it('records occurred_at from the message', () => {
    const parsed = parseBkash(fixture('docs/api.md').raw)
    // 03/09/2026 14:35 Dhaka is 08:35 UTC.
    expect(parsed.occurredAt?.toISOString()).toBe('2026-09-03T08:35:00.000Z')
  })

  /*
   * The stamp is what the payment window is measured against, so reading it
   * wrongly does not fail loudly — it silently refuses real payments as
   * `before_window` or `after_window`. Two things have to be right and neither
   * is visible in the text: that 04/09 is the fourth of September rather than
   * the ninth of April, and that the clock is Dhaka's rather than the server's.
   */
  it('reads a live stamp as Bangladesh time, day first', () => {
    expect(parseBkash(fixture('LIVE — send money with a reference').raw).occurredAt?.toISOString())
      // 04/09/2026 19:54 in Dhaka (UTC+6) is 13:54 UTC on the fourth.
      .toBe('2026-09-04T13:54:00.000Z')

    expect(parseBkash(fixture('LIVE — send money with no reference').raw).occurredAt?.toISOString())
      // 03/09/2026 16:49 Dhaka is 10:49 UTC on the third.
      .toBe('2026-09-03T10:49:00.000Z')
  })

  it('never throws, whatever it is handed', () => {
    const hostile = ['', ' '.repeat(4000), '\0\0', 'Tk Tk Tk TrxID', '💸'.repeat(500)]
    for (const raw of hostile) {
      expect(() => parseBkash(raw)).not.toThrow()
      expect(parseBkash(raw).parseStatus).toBe('failed')
    }
  })
})

describe('Nagad parser', () => {
  it('fails loudly rather than guessing at an unverified format', () => {
    const parsed = parseNagad('Nagad: You received Tk 500.00')
    expect(parsed.parseStatus).toBe('failed')
    expect(parsed.amountCents).toBeNull()
    expect(parsed.error).toMatch(/open decision/i)
  })
})

describe('parseMessage', () => {
  it('routes by the receiving account provider, not by the text', () => {
    const parsed = parseMessage('bkash', fixture('docs/api.md').raw, 'com.bKash.customerapp')
    expect(parsed.parseStatus).toBe('ok')
    expect(parsed.trxId).toBe('BK7X2M9QP1')
  })

  it('routes a live capture end to end', () => {
    const parsed = parseMessage('bkash', fixture('LIVE — send money with a reference').raw)
    expect(parsed.parseStatus).toBe('ok')
    expect(parsed.trxId).toBe('DI4760E7CN')
    expect(parsed.referenceRaw).toBe('12341234')
  })

  it('rejects a notification from an unrelated app', () => {
    const parsed = parseMessage('bkash', 'Your food delivery is 5 minutes away', 'com.foodpanda')
    expect(parsed.parseStatus).toBe('failed')
  })

  /*
   * The regression this file exists to prevent twice over. SMS, manual entry,
   * statement rows and the signed webhook all arrive with no package name, and
   * a real bKash SMS contains neither the word "bkash" nor a `BK`-prefixed
   * TrxID. Gating those on the text looking bKash-ish dropped every one of them
   * into the unparsed queue — including the SMS path, which is one of the two
   * primary adapters.
   */
  it('parses a message with no package name, on the account provider alone', () => {
    const raw =
      'You have received Tk 450.00 from 01712345678. Ref A7K2. Fee Tk 0.00. ' +
      'Balance Tk 45,320.00. TrxID 3F1A2B9C4D at 03/09/2026 14:35'

    const parsed = parseMessage('bkash', raw, null)
    expect(parsed.parseStatus).toBe('ok')
    expect(parsed.trxId).toBe('3F1A2B9C4D')
    expect(parsed.amountCents).toBe(45_000)
    expect(parsed.referenceRaw).toBe('A7K2')
  })

  it('still fails a message with no package name that has no amount or TrxID', () => {
    const parsed = parseMessage('bkash', 'Your recharge of 30 taka was successful.', null)
    expect(parsed.parseStatus).toBe('failed')
  })

  it('never throws', () => {
    expect(() => parseMessage('nagad', 'anything at all', null)).not.toThrow()
  })
})

describe('transaction types', () => {
  /*
   * Only `send_money` can settle an order (see matching/resolve.ts), but the
   * other three decide what an operator's feed is buried in. `outgoing` exists
   * separately from `other` so somebody can keep a record of money they sent
   * without also keeping every promotional message bKash pushes.
   */
  const type = (raw: string) => parseBkash(raw).transactionType

  it('reads an incoming send money', () => {
    expect(type(fixture('LIVE — send money with a reference').raw)).toBe('send_money')
  })

  it('reads the real outgoing confirmation as outgoing, not other', () => {
    expect(type(fixture('an OUTGOING send money').raw)).toBe('outgoing')
  })

  /*
   * The direction guarantee, asserted at the parser rather than left to the
   * matcher. An outgoing message now parses cleanly, so the only thing standing
   * between "Send Money Tk 10.00 to 015…" and a credited order is the type — and
   * a stray alternation in the amount pattern would be enough to lose it.
   */
  it('never reads money leaving the account as an amount received from someone', () => {
    const outgoing = parseBkash(fixture('an OUTGOING send money').raw)

    expect(outgoing.transactionType).toBe('outgoing')
    expect(outgoing.amountCents).toBe(1_000)
    // 01518920430 is who the money went to. Reading it as the sender would put a
    // real number on a row the matcher scores by sender.
    expect(outgoing.senderMsisdn).toBeNull()
  })

  it('does not degrade an outgoing message for having no sender', () => {
    // It never has one. Flagging that as a partial parse would mark every
    // transfer the operator makes as a problem to look into.
    const outgoing = parseBkash(fixture('an OUTGOING send money').raw)
    expect(outgoing.parseStatus).toBe('ok')
    expect(outgoing.error).toBeNull()
  })

  it('reads a cash in', () => {
    expect(
      type('Cash In Tk 500.00 from Agent 01712345678 successful. Balance Tk 1,940.62. TrxID CI1'),
    ).toBe('cash_in')
  })

  it('leaves marketing as other', () => {
    expect(
      type('Get 10% cashback on your next bKash payment! Offer valid till 30 September.'),
    ).toBe('other')
  })
})
