import type { IntentStatus, MatchConfidence, MatchedBy } from '@jomma/shared'
import { toPublicId } from '@jomma/shared'
import { and, eq, isNull, sql } from 'drizzle-orm'
import type { Tx } from '@/lib/db/client'
import { amountLocks, incomingPayments, orderPayments, paymentIntents } from '@/lib/db/schema'
import { audit } from './audit'
import { queueEvent } from './events'
import { consumeRefCode, isUniqueViolation } from './refs'

/**
 * Applying a payment to an intent. The single write path.
 *
 * Automatic matching, a buyer's TrxID submission, and an admin approving from
 * the queue all call this. Duplicating it per entry point is how two of the
 * three end up subtly different, and the one that is wrong is the one that
 * pays out twice.
 *
 * Must be called inside a transaction.
 */

export class LockRaceError extends Error {
  constructor() {
    super('lock_race')
    this.name = 'LockRaceError'
  }
}

export class AlreadyAppliedError extends Error {
  readonly appliedToIntentId: string | null
  constructor(appliedToIntentId: string | null) {
    super('This payment has already been applied.')
    this.name = 'AlreadyAppliedError'
    this.appliedToIntentId = appliedToIntentId
  }
}

export interface ApplyResult {
  intentStatus: IntentStatus
  receivedCents: number
  shortfallCents: number
  excessCents: number
  eventId: string | null
}

export interface ApplyOptions {
  intentId: string
  incomingPaymentId: string
  appliedCents: number
  confidence: MatchConfidence
  matchedBy: MatchedBy
  matchScore?: number | null
  /** Null actor means the matcher did it. */
  actorId?: string | null
  requestId?: string | null
}

export async function applyPayment(tx: Tx, options: ApplyOptions): Promise<ApplyResult> {
  const now = new Date()

  const intent = await tx.query.paymentIntents.findFirst({
    where: eq(paymentIntents.id, options.intentId),
  })
  if (!intent) throw new Error(`Unknown intent ${options.intentId}`)

  /*
   * Race guard 1 — the lock.
   *
   * A conditional update, exactly as docs/matching.md specifies: two
   * simultaneous approvals both try to flip the same row from `active`, one
   * updates zero rows and rolls back.
   *
   * An intent with no active lock (an expired one being revived, or a top-up on
   * a partial) is allowed through — there is nothing to race for.
   */
  const activeLock = await tx.query.amountLocks.findFirst({
    where: and(eq(amountLocks.intentId, options.intentId), eq(amountLocks.status, 'active')),
  })

  if (activeLock) {
    const won = await tx
      .update(amountLocks)
      .set({ status: 'consumed', consumedAt: now })
      .where(and(eq(amountLocks.id, activeLock.id), eq(amountLocks.status, 'active')))
      .returning({ id: amountLocks.id })

    if (won.length === 0) throw new LockRaceError()
  }

  /*
   * Race guard 2 — the payment.
   *
   * `ux_order_payments_incoming` is a unique index on incoming_payment_id, so a
   * TrxID can only ever be spent once. This catches the concurrent case; the
   * pre-check in resolveSubmission catches the common one with a better message.
   */
  try {
    await tx.insert(orderPayments).values({
      intentId: options.intentId,
      incomingPaymentId: options.incomingPaymentId,
      appliedCents: options.appliedCents,
      appliedAt: now,
      appliedBy: options.actorId ?? null,
      matchConfidence: options.confidence,
      matchedBy: options.matchedBy,
      matchScore: options.matchScore ?? null,
    })
  } catch (error) {
    if (isUniqueViolation(error)) {
      const existing = await tx.query.orderPayments.findFirst({
        where: eq(orderPayments.incomingPaymentId, options.incomingPaymentId),
      })
      throw new AlreadyAppliedError(existing?.intentId ?? null)
    }
    throw error
  }

  await tx
    .update(incomingPayments)
    .set({ status: 'matched' })
    .where(eq(incomingPayments.id, options.incomingPaymentId))

  // Underpayment is cumulative: sum every non-reversed application, never
  // replace. Two ৳600 payments satisfy a ৳1,200 intent.
  const [totals] = await tx
    .select({
      total: sql<string>`coalesce(sum(${orderPayments.appliedCents}), 0)`,
    })
    .from(orderPayments)
    .where(and(eq(orderPayments.intentId, options.intentId), isNull(orderPayments.reversedAt)))

  const receivedCents = Number(totals?.total ?? 0)
  const status = statusFor(receivedCents, intent.amountCents)
  const shortfallCents = Math.max(0, intent.amountCents - receivedCents)
  const excessCents = Math.max(0, receivedCents - intent.amountCents)

  await tx
    .update(paymentIntents)
    .set({
      status,
      receivedAmountCents: receivedCents,
      matchedAt: status === 'matched' || status === 'over' ? now : null,
    })
    .where(eq(paymentIntents.id, options.intentId))

  // A partial keeps its code open — the buyer tops up using the same reference.
  if (status === 'matched' || status === 'over') {
    await consumeRefCode(tx, options.intentId, now)
  }

  await audit(tx, {
    action: 'payment.matched',
    actorId: options.actorId ?? null,
    actorType: options.actorId ? 'admin' : 'system',
    appId: intent.appId,
    intentId: options.intentId,
    incomingPaymentId: options.incomingPaymentId,
    requestId: options.requestId ?? null,
    payload: {
      applied_cents: options.appliedCents,
      received_cents: receivedCents,
      intent_amount_cents: intent.amountCents,
      status,
      confidence: options.confidence,
      matched_by: options.matchedBy,
      score: options.matchScore ?? null,
    },
  })

  const payment = await tx.query.incomingPayments.findFirst({
    where: eq(incomingPayments.id, options.incomingPaymentId),
  })

  const eventId = await queueEvent(tx, {
    appId: intent.appId,
    type:
      status === 'over'
        ? 'payment.overpaid'
        : status === 'partial'
          ? 'payment.partial'
          : 'payment.succeeded',
    data: {
      intent_id: toPublicId('intent', intent.id),
      client_reference: intent.clientReference,
      amount: intent.amountCents,
      received_amount: receivedCents,
      trx_id: payment?.trxId ?? null,
      sender_msisdn: payment?.senderMsisdn ?? null,
      match_confidence: options.confidence,
      matched_by: options.matchedBy,
      metadata: intent.metadata,
      ...(status === 'partial' ? { shortfall: shortfallCents } : {}),
      ...(status === 'over' ? { excess: excessCents } : {}),
    },
  })

  return {
    intentStatus: status,
    receivedCents,
    shortfallCents,
    excessCents,
    eventId,
  }
}

function statusFor(receivedCents: number, amountCents: number): IntentStatus {
  if (receivedCents > amountCents) return 'over'
  if (receivedCents >= amountCents) return 'matched'
  return 'partial'
}

/**
 * Undoes an approved match.
 *
 * Never a delete. The application row is marked reversed, the payment goes back
 * to `unmatched` so it can be re-matched or refunded, and the intent's totals
 * are recomputed from what is left. `payment.reversed` means Jomma previously
 * told a client money arrived and is now retracting that, so it is deliberately
 * loud in the audit trail.
 */
export async function reversePayment(
  tx: Tx,
  options: {
    orderPaymentId: string
    actorId: string
    reason: string
    requestId?: string | null
  },
): Promise<void> {
  const now = new Date()

  const application = await tx.query.orderPayments.findFirst({
    where: and(eq(orderPayments.id, options.orderPaymentId), isNull(orderPayments.reversedAt)),
  })
  if (!application) throw new Error('No such application, or it is already reversed.')

  const intent = await tx.query.paymentIntents.findFirst({
    where: eq(paymentIntents.id, application.intentId),
  })
  if (!intent) throw new Error('Orphaned application row.')

  await tx
    .update(orderPayments)
    .set({
      reversedAt: now,
      reversedBy: options.actorId,
      reversalReason: options.reason,
    })
    .where(eq(orderPayments.id, options.orderPaymentId))

  await tx
    .update(incomingPayments)
    .set({ status: 'unmatched' })
    .where(eq(incomingPayments.id, application.incomingPaymentId))

  const [totals] = await tx
    .select({
      total: sql<string>`coalesce(sum(${orderPayments.appliedCents}), 0)`,
    })
    .from(orderPayments)
    .where(and(eq(orderPayments.intentId, application.intentId), isNull(orderPayments.reversedAt)))

  const receivedCents = Number(totals?.total ?? 0)
  const status: IntentStatus =
    receivedCents === 0 ? 'open' : statusFor(receivedCents, intent.amountCents)

  await tx
    .update(paymentIntents)
    .set({ status, receivedAmountCents: receivedCents, matchedAt: null })
    .where(eq(paymentIntents.id, application.intentId))

  await audit(tx, {
    action: 'payment.reversed',
    actorId: options.actorId,
    actorType: 'admin',
    appId: intent.appId,
    intentId: application.intentId,
    incomingPaymentId: application.incomingPaymentId,
    requestId: options.requestId ?? null,
    payload: {
      reason: options.reason,
      reverted_cents: application.appliedCents,
      status,
    },
  })

  await queueEvent(tx, {
    appId: intent.appId,
    type: 'payment.reversed',
    data: {
      intent_id: toPublicId('intent', intent.id),
      client_reference: intent.clientReference,
      amount: intent.amountCents,
      received_amount: receivedCents,
      trx_id: null,
      sender_msisdn: null,
      match_confidence: null,
      matched_by: null,
      metadata: intent.metadata,
      reason: options.reason,
    },
  })
}
