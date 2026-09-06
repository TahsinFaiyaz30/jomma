import { describe, expect, it } from 'vitest'

import { createIntentSchema, msisdnSchema, safeText } from './schemas'

/**
 * What the validation layer promises.
 *
 * Its contract is that bad input produces a 4xx, and the only way that promise
 * breaks silently is when something Zod calls "a string" is not something
 * Postgres will store. These tests exist because of one such case found by
 * fuzzing the live API: a NUL byte sailed through Zod, through the driver, and
 * blew up in the database as a 500 — a reliable way for anyone holding a key to
 * make the intents endpoint throw, on input validation was supposed to catch.
 */

/**
 * Built from code points rather than typed into the file.
 *
 * A literal control character in source is invisible to the next reader and
 * survives exactly until somebody's editor trims it -- at which point the test
 * still passes while testing nothing.
 */

const ch = (code: number) => String.fromCharCode(code)

const CONTROL_CASES: [string, string][] = [
  ['NUL on its own', ch(0)],

  ['NUL in the middle', `a${ch(0)}b`],

  ['leading NUL', `${ch(0)}abc`],

  ['backspace', `a${ch(8)}b`],

  ['line feed', `a${ch(10)}b`],

  ['carriage return', `a${ch(13)}b`],

  ['tab', `a${ch(9)}b`],

  ['vertical tab', `a${ch(11)}b`],

  ['escape', `a${ch(27)}b`],

  ['DEL', `a${ch(127)}b`],
]

describe('safeText', () => {
  for (const [label, value] of CONTROL_CASES) {
    it(`rejects ${label}`, () => {
      expect(safeText(255).safeParse(value).success).toBe(false)
    })
  }

  it('accepts ordinary references', () => {
    expect(safeText(255).safeParse('ORD-2026-001043').success).toBe(true)
  })

  it('accepts Bengali, which is the market this is built for', () => {
    expect(safeText(255).safeParse('অর্ডার-৪২').success).toBe(true)
  })

  it('accepts emoji, which arrive from real storefronts', () => {
    // Deliberately not filtered. They are storable, displayable and somebody's

    // order id; rejecting them would be inventing a rule the database does not

    // have.

    expect(safeText(255).safeParse('order 🎉 42').success).toBe(true)
  })

  it('still enforces its length bound', () => {
    expect(safeText(8).safeParse('x'.repeat(9)).success).toBe(false)
  })
})

describe('msisdnSchema', () => {
  it('rejects a control character hidden in a number', () => {
    expect(msisdnSchema.safeParse(`8801712345678${ch(0)}`).success).toBe(false)
  })

  it('still accepts the formats people actually send', () => {
    for (const value of ['8801712345678', '01712345678', '+880 1712-345678']) {
      expect(msisdnSchema.safeParse(value).success).toBe(true)
    }
  })
})

describe('createIntentSchema', () => {
  const base = { amount: 50_000, client_reference: 'ORD-1' }

  it('rejects a NUL in the client reference', () => {
    expect(createIntentSchema.safeParse({ ...base, client_reference: `a${ch(0)}b` }).success).toBe(
      false,
    )
  })

  it('rejects a NUL in the payer number', () => {
    expect(
      createIntentSchema.safeParse({ ...base, payer_msisdn: `8801712345678${ch(0)}` }).success,
    ).toBe(false)
  })

  it('accepts an ordinary intent', () => {
    expect(createIntentSchema.safeParse(base).success).toBe(true)
  })
})
