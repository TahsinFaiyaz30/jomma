import { describe, expect, it } from 'vitest'
import { parseStatementCsv } from './statement-import'

/**
 * Only the pure CSV parsing is tested here — `importStatement` touches the
 * database and is exercised through the Reconcile screen.
 */

describe('parseStatementCsv', () => {
  it('reads a straightforward export', () => {
    const csv = [
      'Date,TrxID,Type,Sender,Amount,Reference,Balance',
      '03/09/2026 14:35,BK7X2M9QP1,Received,01712345678,"1,200.00",K7M2,"45,320.00"',
      '03/09/2026 15:02,BK3M8N2VC5,Cash In,01911111111,"5,000.00",,"50,320.00"',
    ].join('\n')

    const { rows, errors } = parseStatementCsv(csv)

    expect(errors).toHaveLength(0)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({
      trxId: 'BK7X2M9QP1',
      amountCents: 120_000,
      senderMsisdn: '8801712345678',
      reference: 'K7M2',
      balanceAfterCents: 4_532_000,
      transactionType: 'send_money',
    })
    // A cash-in must not be classified as a send-money, exactly as in the parser.
    expect(rows[1]?.transactionType).toBe('cash_in')
  })

  it('handles quoted fields containing commas', () => {
    const csv = ['TrxID,Amount', 'BK1,"1,234.56"'].join('\n')
    expect(parseStatementCsv(csv).rows[0]?.amountCents).toBe(123_456)
  })

  it('parses DD/MM/YYYY as Dhaka local time', () => {
    const csv = ['Date,TrxID,Amount', '03/09/2026 14:35,BK1,100.00'].join('\n')
    // 14:35 in Dhaka is 08:35 UTC.
    expect(parseStatementCsv(csv).rows[0]?.occurredAt?.toISOString()).toBe(
      '2026-09-03T08:35:00.000Z',
    )
  })

  it('matches columns loosely, since the real export format is unverified', () => {
    const csv = ['Transaction ID,Credit Amount', 'BK9,500.00'].join('\n')
    const { rows, errors } = parseStatementCsv(csv)
    expect(errors).toHaveLength(0)
    expect(rows[0]?.trxId).toBe('BK9')
  })

  it('skips a row it cannot read rather than inventing an amount', () => {
    const csv = ['TrxID,Amount', 'BK1,not-a-number', 'BK2,100.00'].join('\n')
    const { rows, errors } = parseStatementCsv(csv)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.trxId).toBe('BK2')
    expect(errors[0]).toMatch(/BK1/)
  })

  it('refuses a file with no TrxID column instead of importing nothing silently', () => {
    const csv = ['Date,Amount', '03/09/2026,100.00'].join('\n')
    const { rows, errors } = parseStatementCsv(csv)
    expect(rows).toHaveLength(0)
    expect(errors.join(' ')).toMatch(/TrxID/i)
  })

  it('normalises TrxIDs the same way the capture path does', () => {
    const csv = ['TrxID,Amount', ' bk7x2m9qp1 ,100.00'].join('\n')
    // Must match, or a statement row would not deduplicate against the capture.
    expect(parseStatementCsv(csv).rows[0]?.trxId).toBe('BK7X2M9QP1')
  })

  it('reports an empty file rather than throwing', () => {
    expect(parseStatementCsv('').errors).toHaveLength(1)
    expect(parseStatementCsv('TrxID,Amount').errors).toHaveLength(1)
  })
})
