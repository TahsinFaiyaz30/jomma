import 'server-only'

import { type RefundReason, toPublicId } from '@jomma/shared'
import { and, desc, eq } from 'drizzle-orm'
import { ApiError } from '@/lib/api/errors'
import { db } from '@/lib/db/client'
import { paymentIntents, refundRequests } from '@/lib/db/schema'
import { audit } from './audit'
import { queueEvent } from './events'

/**
 * A buyer asking for money back.
 *
 * **Jomma never moves money out.** It has no payout path and should not grow
 * one: it watches a merchant's own accounts and has no authority over them, so
 * the honest thing it can do is record the ask, tie it to the payment it is
 * about, and tell the store over the same signed webhook it hears everything
 * else on. The refund happens where the order lives.
 *
 * Two reasons a buyer reaches for this. They overpaid — which now completes the
 * order automatically, so the excess is a debt nobody would otherwise chase. Or
 * they want to cancel, which Jomma cannot do either: the order is the store's.
 */

export interface RefundRequestResult {
  id: string
  status: string
  /** True when an identical open request already existed. */
  duplicate: boolean
}

/** Generous, but not a place to paste a novel. */
const MAX_NOTE = 500

export async function requestRefund(options: {
  intentId: string
  reason: RefundReason
  note?: string | null
  contactMsisdn?: string | null
  requestId?: string
}): Promise<RefundRequestResult> {
  const intent = await db.query.paymentIntents.findFirst({
    where: eq(paymentIntents.id, options.intentId),
  })
  if (!intent) throw ApiError.notFound('No such payment.')

  /*
   * Nothing to give back if nothing arrived. Worth refusing rather than
   * recording: an open request against an unpaid intent is noise in the
   * dashboard and would have a merchant looking for a payment that never
   * happened.
   */
  if (intent.receivedAmountCents <= 0) {
    throw ApiError.noCapacity('Nothing has been received against this payment yet.')
  }

  /*
   * One open request per intent per reason. A buyer pressing the button twice
   * is impatience, not a second claim, and two rows would have the merchant
   * refunding twice if they worked the list quickly.
   */
  const existing = await db.query.refundRequests.findFirst({
    where: and(
      eq(refundRequests.intentId, intent.id),
      eq(refundRequests.reason, options.reason),
      eq(refundRequests.status, 'open'),
    ),
    orderBy: desc(refundRequests.createdAt),
  })

  if (existing) {
    return { id: existing.id, status: existing.status, duplicate: true }
  }

  const excess = Math.max(0, intent.receivedAmountCents - intent.amountCents)
  // What the buyer is owed, as far as Jomma can tell. Advisory — a cancellation
  // is the whole payment back, an overpayment only the excess, and either way
  // the store decides what it actually returns.
  const amountCents = options.reason === 'overpaid' ? excess : intent.receivedAmountCents

  const created = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(refundRequests)
      .values({
        intentId: intent.id,
        reason: options.reason,
        amountCents: amountCents > 0 ? amountCents : null,
        note: options.note?.slice(0, MAX_NOTE) ?? null,
        contactMsisdn: options.contactMsisdn ?? null,
      })
      .returning()
    if (!row) throw new Error('Insert returned no refund request')

    await audit(tx, {
      action: 'intent.refund_requested',
      actorType: 'client',
      appId: intent.appId,
      intentId: intent.id,
      requestId: options.requestId ?? null,
      payload: { reason: options.reason, amount_cents: amountCents },
    })

    await queueEvent(tx, {
      appId: intent.appId,
      type: 'payment.refund_requested',
      data: {
        intent_id: toPublicId('intent', intent.id),
        client_reference: intent.clientReference,
        amount: intent.amountCents,
        received_amount: intent.receivedAmountCents,
        trx_id: null,
        sender_msisdn: null,
        match_confidence: null,
        matched_by: null,
        metadata: intent.metadata,
        excess: excess > 0 ? excess : undefined,
        refund_request: {
          id: row.id,
          reason: options.reason,
          amount: amountCents,
          note: row.note,
        },
      },
    })

    return row
  })

  return { id: created.id, status: created.status, duplicate: false }
}

/** Open requests for the dashboard, newest first. */
export async function listOpenRefundRequests() {
  return db
    .select({
      id: refundRequests.id,
      reason: refundRequests.reason,
      status: refundRequests.status,
      amountCents: refundRequests.amountCents,
      note: refundRequests.note,
      contactMsisdn: refundRequests.contactMsisdn,
      createdAt: refundRequests.createdAt,
      intentId: refundRequests.intentId,
      clientReference: paymentIntents.clientReference,
      intentAmountCents: paymentIntents.amountCents,
      receivedAmountCents: paymentIntents.receivedAmountCents,
    })
    .from(refundRequests)
    .innerJoin(paymentIntents, eq(paymentIntents.id, refundRequests.intentId))
    .where(eq(refundRequests.status, 'open'))
    .orderBy(desc(refundRequests.createdAt))
    .limit(200)
}
