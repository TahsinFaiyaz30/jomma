import { and, eq } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'
import { db, pool } from '@/lib/db/client'
import {
  incomingPayments,
  orderPayments,
  paymentIntents,
  paymentSubmissions,
  receivingAccounts,
} from '@/lib/db/schema'
import { resolveSubmission } from '@/lib/services/submissions'

/**
 * A submitted TrxID must belong to the intent's own receiving account.
 *
 * The automatic matcher gates on the receiving account: it only ever considers
 * candidates for the account a payment landed on. For a long time this path did
 * not — it looked the TrxID up globally — so quoting the number of a payment
 * that arrived on a *different* account, or a different provider entirely, got
 * it credited to this intent.
 *
 * The money is the merchant's either way, so nothing was stealable. What broke
 * is worse in a quieter way: an amount lock held on one account satisfied by
 * money on another, per-account reconciliation and balance continuity both
 * wrong, and a buyer able to pay by a method they did not choose.
 *
 *   pnpm db:up && pnpm db:migrate && pnpm db:seed
 *   pnpm --filter @jomma/web test:integration
 */

const nonce = Date.now().toString(36).toUpperCase().slice(-6)
const FOREIGN_TRX = `BK${nonce}OTHER`
const OWN_TRX = `BK${nonce}OWN`
const CLIENT_REF = `SCOPE-${nonce}`
const AMOUNT = 31_337

afterAll(async () => {
  const intents = await db
    .select({ id: paymentIntents.id })
    .from(paymentIntents)
    .where(eq(paymentIntents.clientReference, CLIENT_REF))

  for (const intent of intents) {
    await db.delete(orderPayments).where(eq(orderPayments.intentId, intent.id))
    await db.delete(paymentSubmissions).where(eq(paymentSubmissions.intentId, intent.id))
  }
  await db.delete(paymentIntents).where(eq(paymentIntents.clientReference, CLIENT_REF))
  await db.delete(incomingPayments).where(eq(incomingPayments.trxId, FOREIGN_TRX))
  await db.delete(incomingPayments).where(eq(incomingPayments.trxId, OWN_TRX))
  await pool.end()
})

describe('resolveSubmission account scoping', () => {
  it('will not credit a TrxID that landed on another receiving account', async () => {
    const accounts = await db.select().from(receivingAccounts).orderBy(receivingAccounts.msisdn)
    expect(accounts.length, 'run pnpm db:seed first — needs two accounts').toBeGreaterThan(1)

    const own = accounts[0]
    const other = accounts[1]
    if (!own || !other) return

    const [intent] = await db
      .insert(paymentIntents)
      .values({
        appId: (await db.query.apps.findFirst())?.id as string,
        receivingAccountId: own.id,
        amountCents: AMOUNT,
        clientReference: CLIENT_REF,
        ttlSeconds: 900,
        expiresAt: new Date(Date.now() + 900_000),
        status: 'open',
      })
      .returning()
    if (!intent) throw new Error('intent not created')

    // The same amount, on the merchant's *other* account. Everything about it
    // looks payable except where it landed.
    await db.insert(incomingPayments).values({
      receivingAccountId: other.id,
      provider: other.provider,
      trxId: FOREIGN_TRX,
      amountCents: AMOUNT,
      senderMsisdn: '8801712345678',
      rawMessage: 'landed on the other account',
      source: 'notification',
      adapter: 'android_notification',
      parseStatus: 'ok',
      status: 'unmatched',
      transactionType: 'send_money',
    })

    const foreign = await resolveSubmission({
      intentId: intent.id,
      appId: intent.appId,
      trxId: FOREIGN_TRX,
      senderMsisdn: null,
      claimedAmountCents: null,
      ip: null,
      requestId: `test-${nonce}-1`,
    })

    // Not found *for this intent*. Never approved.
    expect(foreign.resolution).toMatch(/^not_found_/)

    const credited = await db
      .select()
      .from(orderPayments)
      .where(eq(orderPayments.intentId, intent.id))
    expect(credited).toHaveLength(0)

    const [after] = await db
      .select({ received: paymentIntents.receivedAmountCents, status: paymentIntents.status })
      .from(paymentIntents)
      .where(eq(paymentIntents.id, intent.id))
    expect(after?.received).toBe(0)
    expect(after?.status).toBe('open')
  })

  it('still credits a TrxID on the intent’s own account', async () => {
    const intent = await db.query.paymentIntents.findFirst({
      where: eq(paymentIntents.clientReference, CLIENT_REF),
    })
    if (!intent) throw new Error('intent from the previous case is missing')

    await db.insert(incomingPayments).values({
      receivingAccountId: intent.receivingAccountId,
      provider: 'bkash',
      trxId: OWN_TRX,
      amountCents: AMOUNT,
      senderMsisdn: '8801712345678',
      rawMessage: 'landed on the right account',
      source: 'notification',
      adapter: 'android_notification',
      parseStatus: 'ok',
      status: 'unmatched',
      transactionType: 'send_money',
    })

    const own = await resolveSubmission({
      intentId: intent.id,
      appId: intent.appId,
      trxId: OWN_TRX,
      senderMsisdn: '8801712345678',
      claimedAmountCents: null,
      ip: null,
      requestId: `test-${nonce}-2`,
    })

    expect(own.resolution).toBe('exact')

    const credited = await db
      .select()
      .from(orderPayments)
      .where(and(eq(orderPayments.intentId, intent.id)))
    expect(credited).toHaveLength(1)
  })
})
