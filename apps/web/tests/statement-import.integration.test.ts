import { eq } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'
import { db, pool } from '@/lib/db/client'
import { incomingPayments, receivingAccounts } from '@/lib/db/schema'
import { importStatement } from '@/lib/services/statement-import'

/**
 * Statement import against a real database.
 *
 * The claim this is checking is the one the whole feature exists for: rows the
 * notifier already captured collide on `trx_id` and are absorbed, and what is
 * left is money nobody knew about.
 *
 *   pnpm db:up && pnpm db:migrate && pnpm db:seed
 *   pnpm --filter @jomma/web test:integration
 */

const ADMIN = '00000000-0000-0000-0000-000000000000'
const nonce = Date.now().toString(36).toUpperCase().slice(-5)
const KNOWN = `BK${nonce}KNOWN`
const MISSED = `BK${nonce}MISSED`
const AGENT = `BK${nonce}AGENT`

afterAll(async () => {
  await db.delete(incomingPayments).where(eq(incomingPayments.trxId, KNOWN))
  await db.delete(incomingPayments).where(eq(incomingPayments.trxId, MISSED))
  await db.delete(incomingPayments).where(eq(incomingPayments.trxId, AGENT))
  await pool.end()
})

describe('importStatement', () => {
  it('absorbs what the notifier already saw and surfaces what it missed', async () => {
    const account = await db.query.receivingAccounts.findFirst({
      where: eq(receivingAccounts.msisdn, '8801799887766'),
    })
    expect(account, 'run pnpm db:seed first').toBeDefined()
    if (!account) return

    // Pretend the notifier captured one of these live.
    await db.insert(incomingPayments).values({
      receivingAccountId: account.id,
      provider: 'bkash',
      trxId: KNOWN,
      amountCents: 77_700,
      rawMessage: 'captured live by the notifier',
      source: 'notification',
      adapter: 'android_notification',
      parseStatus: 'ok',
      status: 'unmatched',
      transactionType: 'send_money',
    })

    const csv = [
      'Date,TrxID,Type,Sender,Amount,Reference,Balance',
      `03/09/2026 12:00,${KNOWN},Received,01712345678,"777.00",ZZZZ,"46,097.00"`,
      `03/09/2026 12:30,${MISSED},Received,01755443322,"1,450.00",QQ11,"47,547.00"`,
      `03/09/2026 13:00,${AGENT},Cash In,01911111111,"5,000.00",,"52,547.00"`,
      '03/09/2026 13:30,BKBADROW,Received,01755443322,not-a-number,,"52547.00"',
    ].join('\n')

    const result = await importStatement({
      receivingAccountId: account.id,
      csv,
      actorId: ADMIN,
    })

    expect(result.parsed).toBe(3)
    // The bad row is reported, never guessed at.
    expect(result.skipped).toBe(1)
    expect(result.errors[0]).toMatch(/BKBADROW/)

    // The live capture collided on trx_id — the whole mechanism.
    expect(result.duplicates).toBe(1)

    // Two the notifier never saw. This is the number that matters.
    expect(result.recovered).toBe(2)
    expect(result.recoveredRows.map((r) => r.trxId).sort()).toEqual([AGENT, MISSED].sort())

    const missed = await db.query.incomingPayments.findFirst({
      where: eq(incomingPayments.trxId, MISSED),
    })
    expect(missed?.source).toBe('statement')
    expect(missed?.adapter).toBe('statement_import')
    expect(missed?.amountCents).toBe(145_000)
    expect(missed?.senderMsisdn).toBe('8801755443322')
    expect(missed?.referenceNormalized).toBe('QQ11')

    // `received_at` is when the server learned of it, not when it happened —
    // back-dating it would let a week-old row look "recent" to the matcher.
    expect(missed?.receivedAt.getTime()).toBeGreaterThan(Date.now() - 60_000)
    expect(missed?.occurredAt?.toISOString()).toBe('2026-09-03T06:30:00.000Z')

    // A cash-in is imported but never classified as a send-money.
    const agent = await db.query.incomingPayments.findFirst({
      where: eq(incomingPayments.trxId, AGENT),
    })
    expect(agent?.transactionType).toBe('cash_in')

    // The live capture must not have been overwritten by the statement row.
    const known = await db.query.incomingPayments.findFirst({
      where: eq(incomingPayments.trxId, KNOWN),
    })
    expect(known?.source).toBe('notification')
    expect(known?.amountCents).toBe(77_700)
  })

  it('is idempotent — importing the same file twice recovers nothing new', async () => {
    const account = await db.query.receivingAccounts.findFirst({
      where: eq(receivingAccounts.msisdn, '8801799887766'),
    })
    if (!account) return

    const csv = [
      'Date,TrxID,Type,Sender,Amount',
      `03/09/2026 12:30,${MISSED},Received,01755443322,"1,450.00"`,
    ].join('\n')

    const again = await importStatement({ receivingAccountId: account.id, csv, actorId: ADMIN })

    expect(again.recovered).toBe(0)
    expect(again.duplicates).toBe(1)
  })
})
