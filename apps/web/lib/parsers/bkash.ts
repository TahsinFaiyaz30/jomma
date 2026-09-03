import type { TransactionType } from '@jomma/shared'
import { failed, type MessageParser, type ParsedMessage, takaToPoisha, toE164 } from './types'

/**
 * bKash message parser.
 *
 * ⚠ Written against the single documented sample in docs/api.md:
 *
 *   "You have received Tk 1,200.00 from 01712345678. Ref K7M2. Fee Tk 0.00.
 *    Balance Tk 45,320.00. TrxID BK7X2M9QP1 at 03/09/2026 14:35"
 *
 * That is not a real capture. AGENTS.md open decision #3 — whether the reference
 * the sender typed appears in the recipient's message on every channel (app vs
 * `*247#`) — is still unverified, and the fixtures in ./fixtures are synthetic
 * until a real ৳10 transfer is captured on both channels.
 *
 * The parser is built so this matters as little as possible: each field is
 * extracted independently, a missing one degrades to `partial` rather than
 * `failed`, and `raw_message` is stored before any of this runs. A format change
 * costs an alert and a re-parse, never a lost payment.
 */

const PACKAGES = ['com.bKash.customerapp'] as const

const AMOUNT_RE = /(?:received|receive[d]?)\s*Tk\s*([\d,]+(?:\.\d{1,2})?)/i
const CASH_IN_AMOUNT_RE = /Cash\s*In\s*Tk\s*([\d,]+(?:\.\d{1,2})?)/i
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

    const amountMatch = AMOUNT_RE.exec(raw) ?? CASH_IN_AMOUNT_RE.exec(raw)
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
    if (!senderMsisdn) softMissing.push('sender')

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
  claims(raw, packageName) {
    if (packageName && PACKAGES.includes(packageName as (typeof PACKAGES)[number])) return true
    return /bkash|TrxID\s*[:\s]*BK/i.test(raw)
  },
  parse: parseBkash,
}
