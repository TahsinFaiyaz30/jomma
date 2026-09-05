/**
 * bKash fixtures.
 *
 * Two entries are now real, marked `source: 'live'` — genuine Send Money
 * confirmations off a bKash account, one with a reference typed and one
 * without. They are the ones that matter: everything else here is a plausible
 * variation written to pin degradation behaviour, not to assert what bKash
 * actually sends.
 *
 * The live pair confirmed three things the synthetic ones could only assume —
 * that the reference survives the app as free text, that `DD/MM/YYYY HH:MM` is
 * the real stamp format, and that reading it as Bangladesh time lands on the
 * right instant. Sender numbers are redacted; `.gitignore` already excludes
 * `fixtures/raw/`, so keep unredacted captures there.
 *
 * The third live entry is a `*247#` confirmation, which settles the channel
 * question: the reference survives USSD too. It is also the outgoing direction,
 * and it must fail — see the note on that fixture.
 *
 * Still unverified: Nagad, in its entirety.
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
    transactionType: 'send_money' | 'cash_in' | 'outgoing' | 'other'
    parseStatus: 'ok' | 'partial' | 'failed'
  }
  source: 'docs' | 'synthetic' | 'live'
}

export const BKASH_FIXTURES: Fixture[] = [
  {
    /*
     * A real ৳10.00 transfer. The reference is eight digits because it was
     * typed by hand; a Jomma code never looks like this, since the alphabet
     * drops 0/1/I/L/O to keep codes unambiguous when read aloud.
     */
    name: 'LIVE — send money with a reference',
    source: 'live',
    raw: 'You have received Tk 10.00 from 01771104100. Ref 12341234. Fee Tk 0.00. Balance Tk 1,440.62. TrxID DI4760E7CN at 04/09/2026 19:54',
    expect: {
      trxId: 'DI4760E7CN',
      amountCents: 1_000,
      senderMsisdn: '8801771104100',
      referenceRaw: '12341234',
      balanceAfterCents: 144_062,
      transactionType: 'send_money',
      parseStatus: 'ok',
    },
  },
  {
    /*
     * The same account, no reference typed. This is the case that must NOT
     * auto-match: without a reference there is nothing tying the money to an
     * order, so it waits for a TrxID the buyer submits themselves.
     */
    name: 'LIVE — send money with no reference',
    source: 'live',
    raw: 'You have received Tk 11.00 from 01632553696. Fee Tk 0.00. Balance Tk 2,246.76. TrxID DI304PJ6QK at 03/09/2026 16:49',
    expect: {
      trxId: 'DI304PJ6QK',
      amountCents: 1_100,
      senderMsisdn: '8801632553696',
      referenceRaw: null,
      balanceAfterCents: 224_676,
      transactionType: 'send_money',
      parseStatus: 'ok',
    },
  },
  {
    /*
     * The *sender's* confirmation, captured over `*247#`. Money leaving the
     * account, not arriving on it.
     *
     * The one that must never be read as income. The watched phone can send
     * money too, and this message carries a TrxID, a reference and an amount —
     * everything the matcher looks at. Crediting an order with money that went
     * the other way is the worst bug this repo could have.
     *
     * What stops it is the *type*, not a failure to parse. `resolve.ts` admits
     * `send_money` and nothing else, so an outgoing row is inert however
     * completely it reads.
     *
     * It used to be stopped by failing instead: the incoming grammar is "You
     * have received Tk X from …", so there was nothing here for the amount
     * pattern to anchor on. That worked, and cost too much — every transfer the
     * operator made raised a high-severity parse-failure alert, sat in the
     * manual queue as a mystery, and could not be filtered by the capture
     * settings, since an unreadable message is always kept. Three kinds of noise
     * to re-derive a guarantee the type gate already gives for free.
     *
     * So it parses, and `senderMsisdn` stays null because there is no sender —
     * 01518920430 is the recipient, and there is nowhere in the schema to say
     * so.
     */
    name: 'LIVE — an OUTGOING send money must never be read as income',
    source: 'live',
    raw: 'Send Money Tk 10.00 to 01518920430 successful. Ref 12341234. Fee Tk 0.00. Balance Tk 320.00. TrxID DI426228H2 at 04/09/2026 20:31',
    expect: {
      trxId: 'DI426228H2',
      amountCents: 1_000,
      senderMsisdn: null,
      referenceRaw: '12341234',
      balanceAfterCents: 32_000,
      transactionType: 'outgoing',
      parseStatus: 'ok',
    },
  },
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
