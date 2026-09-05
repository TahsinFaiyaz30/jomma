import type { CaptureSettings } from '@jomma/shared'
import { describe, expect, it } from 'vitest'
import { parseBkash } from '@/lib/parsers/bkash'
import { BKASH_FIXTURES } from '@/lib/parsers/fixtures/bkash'
import { shouldCapture } from './capture'

/**
 * The capture filter.
 *
 * Small enough to read at a glance and important enough to pin, because both
 * ways of getting it wrong are silent. Filter too much and payments stop
 * settling with no error anywhere; filter too little and the operator's feed
 * fills with promotions until nobody reads it.
 */

const KEEP_NOTHING: CaptureSettings = { cash_in: false, outgoing: false, other: false }
const KEEP_EVERYTHING: CaptureSettings = { cash_in: true, outgoing: true, other: true }

function fixture(name: string) {
  const found = BKASH_FIXTURES.find((entry) => entry.name.includes(name))
  if (!found) throw new Error(`No bKash fixture matching "${name}"`)
  return parseBkash(found.raw)
}

describe('shouldCapture', () => {
  it('keeps an incoming send money even when everything is switched off', () => {
    // The one that must never be filterable: it is the only type the matcher
    // will settle an order with.
    expect(shouldCapture(fixture('LIVE — send money with a reference'), KEEP_NOTHING)).toBe(true)
    expect(shouldCapture(fixture('LIVE — send money with no reference'), KEEP_NOTHING)).toBe(true)
  })

  it('keeps a transaction the parser could not read, whatever the settings say', () => {
    // A TrxID it recognises and an amount it does not. This is what a format
    // change looks like, and the raw text is the only evidence available for
    // fixing the parser.
    const unreadable = parseBkash('bKash payment confirmed. TrxID BK9T3N4XM7. Check the app.')
    expect(unreadable.parseStatus).toBe('failed')
    expect(shouldCapture(unreadable, KEEP_NOTHING)).toBe(true)
  })

  /*
   * The line `other` depends on. A promotion has no TrxID and no amount, so it
   * always fails to parse — which meant "keep it, it might be evidence" applied
   * to the single largest source of noise, and `other` was a switch that did
   * nothing.
   */
  it('treats a message with no TrxID and no amount as noise, not as evidence', () => {
    const promotion = parseBkash('Get 10% cashback on your next bKash payment! Valid till 30 Sep.')
    expect(promotion.parseStatus).toBe('failed')
    expect(promotion.trxId).toBeNull()
    expect(promotion.amountCents).toBeNull()

    expect(shouldCapture(promotion, KEEP_NOTHING)).toBe(false)
    expect(shouldCapture(promotion, { ...KEEP_NOTHING, other: true })).toBe(true)
  })

  it('drops cash in, outgoing and marketing by default', () => {
    const cashIn = parseBkash(
      'Cash In Tk 500.00 from Agent 01712345678 successful. Balance Tk 1,940.62. TrxID CI1ABCDE',
    )
    const marketing = parseBkash('Get 10% cashback on your next bKash payment! Valid till 30 Sep.')

    expect(shouldCapture(cashIn, KEEP_NOTHING)).toBe(false)
    expect(shouldCapture(fixture('OUTGOING'), KEEP_NOTHING)).toBe(false)
    expect(shouldCapture(marketing, KEEP_NOTHING)).toBe(false)
  })

  it('keeps each of the three once its own switch is on', () => {
    const cashIn = parseBkash(
      'Cash In Tk 500.00 from Agent 01712345678 successful. Balance Tk 1,940.62. TrxID CI1ABCDE',
    )
    const marketing = parseBkash('Get 10% cashback on your next bKash payment! Valid till 30 Sep.')

    expect(shouldCapture(cashIn, { ...KEEP_NOTHING, cash_in: true })).toBe(true)
    expect(shouldCapture(fixture('OUTGOING'), { ...KEEP_NOTHING, outgoing: true })).toBe(true)
    expect(shouldCapture(marketing, { ...KEEP_NOTHING, other: true })).toBe(true)
  })

  it('does not let one switch leak into another', () => {
    const cashIn = parseBkash(
      'Cash In Tk 500.00 from Agent 01712345678 successful. Balance Tk 1,940.62. TrxID CI1ABCDE',
    )

    // `other` is the catch-all, so it is the one most likely to be wired up as
    // a fallback that quietly re-enables the other two.
    expect(shouldCapture(cashIn, { ...KEEP_NOTHING, other: true })).toBe(false)
    expect(shouldCapture(fixture('OUTGOING'), { ...KEEP_NOTHING, other: true })).toBe(false)
  })

  it('keeps every fixture when everything is on', () => {
    for (const entry of BKASH_FIXTURES) {
      expect(shouldCapture(parseBkash(entry.raw), KEEP_EVERYTHING)).toBe(true)
    }
  })

  it('keeps every live capture even with everything off', () => {
    // The three real messages. Two are income and must always survive; the third
    // is the operator's own outgoing transfer, which is the one thing here a
    // default install is allowed to drop.
    const live = BKASH_FIXTURES.filter((entry) => entry.source === 'live')
    expect(live).toHaveLength(3)

    for (const entry of live) {
      const parsed = parseBkash(entry.raw)
      const kept = shouldCapture(parsed, KEEP_NOTHING)
      expect(kept).toBe(parsed.transactionType !== 'outgoing')
    }
  })
})
