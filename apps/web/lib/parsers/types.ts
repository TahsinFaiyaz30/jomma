import type { ParseStatus, Provider, TransactionType } from '@jomma/shared'

export interface ParsedMessage {
  trxId: string | null
  senderMsisdn: string | null
  amountCents: number | null
  balanceAfterCents: number | null
  feeCents: number | null
  referenceRaw: string | null
  transactionType: TransactionType | null
  /** From the message text. Display only — never used for window logic. */
  occurredAt: Date | null
  parseStatus: ParseStatus
  /** Set when parseStatus is 'partial' or 'failed'. Surfaced in the dashboard. */
  error: string | null
}

export interface MessageParser {
  provider: Provider
  /** Android package ids this parser claims, for routing a notification capture. */
  packages: readonly string[]
  /** Cheap pre-check so an unrelated notification is not run through every regex. */
  claims(raw: string, packageName?: string | null): boolean
  parse(raw: string): ParsedMessage
}

export function failed(error: string): ParsedMessage {
  return {
    trxId: null,
    senderMsisdn: null,
    amountCents: null,
    balanceAfterCents: null,
    feeCents: null,
    referenceRaw: null,
    transactionType: null,
    occurredAt: null,
    parseStatus: 'failed',
    error,
  }
}

/**
 * `"1,200.00"` -> `120000`.
 *
 * Rounded, not truncated: `parseFloat('1200.07') * 100` is 120006.99999999999 in
 * IEEE 754, and truncating would quietly lose a poisha on roughly a third of all
 * amounts. This is the only place a float touches money in the codebase.
 */
export function takaToPoisha(value: string): number | null {
  const cleaned = value.replace(/[,\s৳]/g, '')
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null
  const parsed = Number.parseFloat(cleaned)
  if (!Number.isFinite(parsed)) return null
  return Math.round(parsed * 100)
}

/** `8801712345678` from any of the local formats. Null when there is no number. */
export function toE164(value: string | null | undefined): string | null {
  if (!value) return null
  const digits = value.replace(/\D/g, '')
  if (digits.length < 10) return null
  const local = digits.slice(-10)
  return `880${local}`
}
