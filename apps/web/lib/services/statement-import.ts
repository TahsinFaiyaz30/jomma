import 'server-only'

import type { Provider, TransactionType } from '@jomma/shared'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { incomingPayments, receivingAccounts } from '@/lib/db/schema'
import { logger } from '@/lib/logger'
import { takaToPoisha, toE164 } from '@/lib/parsers'
import { audit } from './audit'
import { runMatcher } from './match-runner'

/**
 * Weekly statement import.
 *
 * The safety net under the notifier. Export the statement from the bKash app,
 * import it here, and `unique(trx_id)` absorbs everything already known — what
 * remains is money the notifier never saw. That residue is the whole point of
 * the exercise, so the result deliberately reports it as a first-class number
 * rather than burying it in a count of rows processed.
 *
 * Imported rows are matched exactly like a live capture. A payment that arrived
 * three days ago and was missed still belongs to whichever intent claims it.
 */

export interface ImportRow {
  trxId: string
  amountCents: number | null
  senderMsisdn: string | null
  reference: string | null
  occurredAt: Date | null
  balanceAfterCents: number | null
  transactionType: TransactionType
  raw: string
}

export interface ImportResult {
  parsed: number
  skipped: number
  /** Already known — the notifier had these. Expected to be the large number. */
  duplicates: number
  /** Money the notifier never saw. This is the number that matters. */
  recovered: number
  matched: number
  errors: string[]
  recoveredRows: Array<{ trxId: string; amountCents: number | null; occurredAt: string | null }>
}

/**
 * Parses a bKash statement CSV.
 *
 * ⚠ Column names are matched loosely because the real export format is
 * unverified — same open question as the message parser. Anything it cannot
 * confidently read is skipped and reported rather than guessed at.
 */
export function parseStatementCsv(csv: string): { rows: ImportRow[]; errors: string[] } {
  const errors: string[] = []
  const lines = csv.split(/\r?\n/).filter((line) => line.trim().length > 0)
  if (lines.length < 2) return { rows: [], errors: ['The file has no data rows.'] }

  const header = splitCsvLine(lines[0] as string).map((h) => h.trim().toLowerCase())

  const findColumn = (...candidates: string[]) =>
    header.findIndex((column) => candidates.some((candidate) => column.includes(candidate)))

  const trxIndex = findColumn('trxid', 'trx id', 'transaction id', 'txn')
  const amountIndex = findColumn('amount', 'received', 'credit')
  const senderIndex = findColumn('sender', 'from', 'counterpart', 'msisdn')
  const referenceIndex = findColumn('reference', 'ref', 'note')
  const dateIndex = findColumn('date', 'time', 'when')
  const balanceIndex = findColumn('balance')
  const typeIndex = findColumn('type', 'description', 'particular')

  if (trxIndex < 0) errors.push('Could not find a TrxID column.')
  if (amountIndex < 0) errors.push('Could not find an amount column.')
  if (errors.length > 0) return { rows: [], errors }

  const rows: ImportRow[] = []

  for (const [offset, line] of lines.slice(1).entries()) {
    const cells = splitCsvLine(line)
    const trxId = cells[trxIndex]
      ?.trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')

    if (!trxId) {
      errors.push(`Row ${offset + 2}: no TrxID, skipped.`)
      continue
    }

    const amountCents = amountIndex >= 0 ? takaToPoisha(cells[amountIndex] ?? '') : null
    if (amountCents === null) {
      errors.push(`Row ${offset + 2} (${trxId}): amount could not be read, skipped.`)
      continue
    }

    const typeCell = (typeIndex >= 0 ? (cells[typeIndex] ?? '') : '').toLowerCase()
    const transactionType: TransactionType = /cash\s*in/.test(typeCell)
      ? 'cash_in'
      : /received|send\s*money|credit/.test(typeCell) || !typeCell
        ? 'send_money'
        : 'other'

    rows.push({
      trxId,
      amountCents,
      senderMsisdn: senderIndex >= 0 ? toE164(cells[senderIndex] ?? null) : null,
      reference: referenceIndex >= 0 ? cells[referenceIndex]?.trim() || null : null,
      occurredAt: dateIndex >= 0 ? parseFlexibleDate(cells[dateIndex] ?? '') : null,
      balanceAfterCents: balanceIndex >= 0 ? takaToPoisha(cells[balanceIndex] ?? '') : null,
      transactionType,
      raw: line,
    })
  }

  return { rows, errors }
}

export async function importStatement(options: {
  receivingAccountId: string
  csv: string
  actorId: string
}): Promise<ImportResult> {
  const account = await db.query.receivingAccounts.findFirst({
    where: eq(receivingAccounts.id, options.receivingAccountId),
  })
  if (!account) throw new Error('Unknown receiving account')

  const { rows, errors } = parseStatementCsv(options.csv)

  const result: ImportResult = {
    parsed: rows.length,
    skipped: errors.length,
    duplicates: 0,
    recovered: 0,
    matched: 0,
    errors,
    recoveredRows: [],
  }

  const toMatch: string[] = []

  for (const row of rows) {
    const [inserted] = await db
      .insert(incomingPayments)
      .values({
        receivingAccountId: account.id,
        provider: account.provider as Provider,
        trxId: row.trxId,
        senderMsisdn: row.senderMsisdn,
        amountCents: row.amountCents,
        balanceAfterCents: row.balanceAfterCents,
        referenceRaw: row.reference,
        referenceNormalized: row.reference
          ? row.reference.toUpperCase().replace(/[^A-Z0-9]/g, '')
          : null,
        transactionType: row.transactionType,
        occurredAt: row.occurredAt,
        // `received_at` is when the server learned of it, which for a statement
        // import is now — not when the transaction happened. Window logic keys
        // off this, and back-dating it would let a week-old row look "recent".
        receivedAt: new Date(),
        rawMessage: row.raw,
        source: 'statement',
        adapter: 'statement_import',
        parseStatus: 'ok',
        status: 'unmatched',
      })
      // The whole mechanism. Everything the notifier already caught collides
      // here and is silently absorbed.
      .onConflictDoNothing({ target: incomingPayments.trxId })
      .returning({ id: incomingPayments.id })

    if (inserted) {
      result.recovered += 1
      result.recoveredRows.push({
        trxId: row.trxId,
        amountCents: row.amountCents,
        occurredAt: row.occurredAt?.toISOString() ?? null,
      })
      toMatch.push(inserted.id)
    } else {
      result.duplicates += 1
    }
  }

  for (const paymentId of toMatch) {
    try {
      const outcome = await runMatcher(paymentId)
      if (outcome.applied) result.matched += 1
    } catch (error) {
      logger.error({ err: error, paymentId }, 'matcher failed on an imported statement row')
    }
  }

  await db.transaction(async (tx) => {
    await audit(tx, {
      action: 'statement.imported',
      actorId: options.actorId,
      actorType: 'admin',
      payload: {
        account_id: account.id,
        parsed: result.parsed,
        duplicates: result.duplicates,
        recovered: result.recovered,
        matched: result.matched,
      },
    })
  })

  if (result.recovered > 0) {
    logger.warn(
      { accountId: account.id, recovered: result.recovered },
      'statement import found payments the notifier never saw',
    )
  }

  return result
}

/** Handles quoted fields containing commas. */
function splitCsvLine(line: string): string[] {
  const cells: string[] = []
  let current = ''
  let quoted = false

  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    if (char === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"'
        i++
      } else {
        quoted = !quoted
      }
    } else if (char === ',' && !quoted) {
      cells.push(current)
      current = ''
    } else {
      current += char
    }
  }
  cells.push(current)
  return cells
}

/** DD/MM/YYYY and ISO both appear in exports. Display only, so a miss is cheap. */
function parseFlexibleDate(value: string): Date | null {
  const trimmed = value.trim()
  if (!trimmed) return null

  const dmy = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?:[\sT]+(\d{1,2}):(\d{2}))?/.exec(trimmed)
  if (dmy) {
    const day = Number(dmy[1])
    const month = Number(dmy[2])
    const year = Number(dmy[3])
    const hour = Number(dmy[4] ?? 0)
    const minute = Number(dmy[5] ?? 0)
    // Bangladesh Standard Time, UTC+6.
    const date = new Date(Date.UTC(year, month - 1, day, hour, minute) - 6 * 3_600_000)
    return Number.isNaN(date.getTime()) ? null : date
  }

  const parsed = new Date(trimmed)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}
