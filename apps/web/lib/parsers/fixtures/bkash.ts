/**
 * bKash fixtures.
 *
 * ⚠ SYNTHETIC. Only the first entry comes from docs/api.md; the rest are
 * plausible variations written to pin the parser's degradation behaviour, not
 * to assert what bKash actually sends.
 *
 * Replace these with real captures before trusting the parser in production —
 * send ৳10 between two of your own numbers via both the app and `*247#`, and
 * save the exact notification and SMS text. `.gitignore` already excludes
 * `fixtures/raw/`, so keep unredacted captures there and commit only redacted
 * copies here.
 */

export interface Fixture {
  name: string
  raw: string
  /** null means "no assertion" — used where the real format is unverified. */
  expect: {
    trxId: string | null
    amountCents: number | null
    senderMsisdn: string | null
    referenceRaw: string | null
    balanceAfterCents: number | null
    transactionType: 'send_money' | 'cash_in' | 'other'
    parseStatus: 'ok' | 'partial' | 'failed'
  }
  source: 'docs' | 'synthetic'
}

export const BKASH_FIXTURES: Fixture[] = [
  {
    name: 'send money with reference — the sample in docs/api.md',
    source: 'docs',
    raw: 'You have received Tk 1,200.00 from 01712345678. Ref K7M2. Fee Tk 0.00. Balance Tk 45,320.00. TrxID BK7X2M9QP1 at 03/09/2026 14:35',
    expect: {
      trxId: 'BK7X2M9QP1',
      amountCents: 120_000,
      senderMsisdn: '8801712345678',
      referenceRaw: 'K7M2',
      balanceAfterCents: 4_532_000,
      transactionType: 'send_money',
      parseStatus: 'ok',
    },
  },
  {
    name: 'send money, no reference typed',
    source: 'synthetic',
    raw: 'You have received Tk 850.00 from 01812345678. Fee Tk 0.00. Balance Tk 46,170.00. TrxID BK5R1L8ZQ2 at 03/09/2026 14:37',
    expect: {
      trxId: 'BK5R1L8ZQ2',
      amountCents: 85_000,
      senderMsisdn: '8801812345678',
      referenceRaw: null,
      balanceAfterCents: 4_617_000,
      transactionType: 'send_money',
      parseStatus: 'ok',
    },
  },
  {
    name: 'agent cash-in — must not be classified as send money',
    source: 'synthetic',
    raw: 'Cash In Tk 5,000.00 from Agent 01911111111. Fee Tk 0.00. Balance Tk 51,170.00. TrxID BK3M8N2VC5 at 03/09/2026 15:02',
    expect: {
      trxId: 'BK3M8N2VC5',
      amountCents: 500_000,
      senderMsisdn: '8801911111111',
      referenceRaw: null,
      balanceAfterCents: 5_117_000,
      transactionType: 'cash_in',
      parseStatus: 'ok',
    },
  },
  {
    name: 'reference typed with spaces and punctuation',
    source: 'synthetic',
    raw: 'You have received Tk 340.00 from 01612345678. Ref: r8-k1. Fee Tk 0.00. Balance Tk 51,510.00. TrxID BK2Y6C0VB4 at 03/09/2026 15:10',
    expect: {
      trxId: 'BK2Y6C0VB4',
      amountCents: 34_000,
      senderMsisdn: '8801612345678',
      referenceRaw: 'r8-k1',
      balanceAfterCents: 5_151_000,
      transactionType: 'send_money',
      parseStatus: 'ok',
    },
  },
  {
    name: 'amount with a fractional poisha value',
    source: 'synthetic',
    raw: 'You have received Tk 1,200.07 from 01712345678. Ref M4Q7. Fee Tk 0.00. Balance Tk 52,710.07. TrxID BK8H1J5KD9 at 03/09/2026 15:20',
    expect: {
      trxId: 'BK8H1J5KD9',
      amountCents: 120_007,
      senderMsisdn: '8801712345678',
      referenceRaw: 'M4Q7',
      balanceAfterCents: 5_271_007,
      transactionType: 'send_money',
      parseStatus: 'ok',
    },
  },
  {
    name: 'no balance reported — degrades to partial, never dropped',
    source: 'synthetic',
    raw: 'You have received Tk 500.00 from 01712345678. Ref P2W9. TrxID BK9T3N4XM7 at 03/09/2026 15:30',
    expect: {
      trxId: 'BK9T3N4XM7',
      amountCents: 50_000,
      senderMsisdn: '8801712345678',
      referenceRaw: 'P2W9',
      balanceAfterCents: null,
      transactionType: 'send_money',
      parseStatus: 'partial',
    },
  },
  {
    name: 'format bKash has never sent — must fail loudly, not guess',
    source: 'synthetic',
    raw: 'Your bKash account has been credited. Please check the app for details.',
    expect: {
      trxId: null,
      amountCents: null,
      senderMsisdn: null,
      referenceRaw: null,
      balanceAfterCents: null,
      transactionType: 'other',
      parseStatus: 'failed',
    },
  },
]
