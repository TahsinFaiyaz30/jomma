import type { TransactionType } from '@jomma/shared'
import { failed, type MessageParser, type ParsedMessage, takaToPoisha, toE164 } from './types'

/**
 * bKash message parser.
 *
 * Verified against real captures. `./fixtures/bkash.ts` holds three marked
 * `source: 'live'` — a received send-money with a reference, the same without
 * one, and a `*247#` outgoing confirmation — which between them settled
 * AGENTS.md open decision #3: the reference the sender types does survive into
 * the recipient's message, on both the app and the USSD channel. The remaining
 * fixtures are synthetic and exist to pin degradation behaviour, not to assert
 * what bKash sends.
 *
 * Still built so a format change matters as little as possible: each field is
 * extracted independently, a missing one degrades to `partial` rather than
 * `failed`, and `raw_message` is stored before any of this runs. A format change
 * costs an alert and a re-parse, never a lost payment.
 *
 * The direction rule is the one thing here that is not forgiving. Money leaving
 * the account carries a TrxID, a reference and an amount — everything the
 * matcher looks at — so reading one as income would credit an order with money
 * that went the other way. `classify` decides direction first, and it decides
 * which pattern is even allowed to read the amount.
 */

const PACKAGES = ['com.bKash.customerapp'] as const

const AMOUNT_RE = /(?:received|receive[d]?)\s*Tk\s*([\d,]+(?:\.\d{1,2})?)/i
const CASH_IN_AMOUNT_RE = /Cash\s*In\s*Tk\s*([\d,]+(?:\.\d{1,2})?)/i
/**
 * The outgoing amount, matched only once `classify` has already said the
 * message is outgoing.
 *
 * Kept as a separate pattern rather than folded into `AMOUNT_RE` on purpose.
 * The incoming grammar is "You have received Tk X from …", and the one thing
 * this parser must never do is read money leaving the account as money arriving
 * on it. Two patterns that cannot match each other's text is a stronger
 * guarantee than one pattern with an alternation in it.
 */
const OUTGOING_AMOUNT_RE = /Send\s*Money\s*Tk\s*([\d,]+(?:\.\d{1,2})?)/i
// The optional word absorbs "from Agent 019…" on a cash-in, where the number
// does not follow "from" directly.
const SENDER_RE = /from\s+(?:[A-Za-z]+\s+)?(?:\+?88)?(0?1[3-9]\d{8})/i
const REFERENCE_RE =
  /\bRef(?:erence)?[.:\s]+([A-Za-z0-9][A-Za-z0-9\s-]{0,15}?)(?=[.,]|\s+Fee|\s+Balance|\s+TrxID|$)/i
const FEE_RE = /Fee\s*Tk\s*([\d,]+(?:\.\d{1,2})?)/i
const BALANCE_RE = /Balance\s*Tk\s*([\d,]+(?:\.\d{1,2})?)/i
const TRX_RE = /TrxID[:\s]*([A-Z0-9]{6,20})/i
const DATETIME_RE = /at\s*(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})/

/** Bangladesh Standard Time, UTC+06:00, no daylight saving. */
const BST_OFFSET_MS = 6 * 60 * 60 * 1000

function classify(raw: string): TransactionType {
  if (/cash\s*in/i.test(raw)) return 'cash_in'
  if (/you\s+have\s+received|received\s+Tk/i.test(raw)) return 'send_money'

  /*
   * Money leaving the account.
   *
   * Tested after the incoming pattern, not before: the watched phone's own
   * outgoing confirmation reads "Send Money Tk 10.00 to 015… successful", and
   * an incoming one never says "to <number> successful". Separating this from
   * `other` is what lets an operator keep their outgoing record without also
   * keeping every promotional message bKash sends.
   *
   * It still cannot settle an order — resolve.ts admits `send_money` only.
   */
  if (/send\s*money\s+tk\b|\bto\s+0?1[3-9]\d{8}\s+successful/i.test(raw)) {
    return 'outgoing'
  }

  return 'other'
}

/** `03/09/2026 14:35` is DD/MM/YYYY local. Display only. */
function parseOccurredAt(raw: string): Date | null {
  const match = DATETIME_RE.exec(raw)
  if (!match) return null
  const [, day, month, year, hour, minute] = match
  const utc = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute))
  const date = new Date(utc - BST_OFFSET_MS)
  return Number.isNaN(date.getTime()) ? null : date
}

export function parseBkash(raw: string): ParsedMessage {
  try {
    const transactionType = classify(raw)

    /*
     * The direction decides which pattern is allowed to read the amount.
     *
     * An outgoing confirmation carries a TrxID, a reference and an amount —
     * everything the matcher looks at — so this branch is the one place where a
     * mistake credits an order with money that went the other way. Gating it on
     * `classify` means the incoming pattern is never even offered the text of an
     * outgoing message.
     */
    const amountMatch =
      transactionType === 'outgoing'
        ? OUTGOING_AMOUNT_RE.exec(raw)
        : (AMOUNT_RE.exec(raw) ?? CASH_IN_AMOUNT_RE.exec(raw))
    const amountCents = amountMatch?.[1] ? takaToPoisha(amountMatch[1]) : null

    const trxId = TRX_RE.exec(raw)?.[1]?.toUpperCase() ?? null

    const senderMsisdn = toE164(SENDER_RE.exec(raw)?.[1] ?? null)
    const balanceMatch = BALANCE_RE.exec(raw)
    const feeMatch = FEE_RE.exec(raw)
    const referenceRaw = REFERENCE_RE.exec(raw)?.[1]?.trim() ?? null

    const missing: string[] = []
    if (amountCents === null) missing.push('amount')
    if (!trxId) missing.push('trx_id')

    // Amount and TrxID are load-bearing: without either, the record cannot be
    // deduplicated or matched, so it is a failure rather than a partial.
    if (missing.length > 0) {
      return {
        ...failed(`Could not extract ${missing.join(' and ')}`),
        // Keep whatever was readable — a reviewer working the queue needs it.
        senderMsisdn,
        amountCents,
        trxId,
        referenceRaw,
        transactionType,
        occurredAt: parseOccurredAt(raw),
      }
    }

    const softMissing: string[] = []
    if (!balanceMatch) softMissing.push('balance')
    // An outgoing message names a recipient, not a sender. Reporting the absence
    // as a degraded parse would flag every one of them as a problem.
    if (!senderMsisdn && transactionType !== 'outgoing') softMissing.push('sender')

    return {
      trxId,
      senderMsisdn,
      amountCents,
      balanceAfterCents: balanceMatch?.[1] ? takaToPoisha(balanceMatch[1]) : null,
      feeCents: feeMatch?.[1] ? takaToPoisha(feeMatch[1]) : null,
      referenceRaw,
      transactionType,
      occurredAt: parseOccurredAt(raw),
      // A missing balance disables the continuity check for this transaction but
      // does not stop the payment being matched.
      parseStatus: softMissing.length > 0 ? 'partial' : 'ok',
      error: softMissing.length > 0 ? `Missing ${softMissing.join(', ')}` : null,
    }
  } catch (error) {
    // Defensive: a parser must never be able to throw its way into losing a
    // message. The caller stores the raw text either way, but this keeps the
    // failure classified rather than a 500.
    return failed(error instanceof Error ? error.message : 'Parser threw')
  }
}

export const bkashParser: MessageParser = {
  provider: 'bkash',
  packages: PACKAGES,
  automatic: true,
  claims(raw, packageName) {
    if (packageName && PACKAGES.includes(packageName as (typeof PACKAGES)[number])) return true
    return /bkash|TrxID\s*[:\s]*BK/i.test(raw)
  },
  parse: parseBkash,
}
