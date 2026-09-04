import 'server-only'

import { and, asc, eq, isNull } from 'drizzle-orm'
import type { Database, Tx } from '@/lib/db/client'
import { db } from '@/lib/db/client'
import { incomingPayments, orderPayments } from '@/lib/db/schema'

/**
 * The instalment ledger for one intent.
 *
 * Several payments can settle one order — the buyer sends part, then the rest,
 * sometimes in three goes. `order_payments` already records each application,
 * so the ledger is those rows in order; what was missing is the arithmetic that
 * makes the sequence legible.
 *
 * The position and the running balance are **derived**, not stored. A `sequence`
 * column would have to be kept correct against reversals, and a reversed second
 * payment leaving a gap at 2 is exactly the kind of drift nobody notices until
 * they are reconciling. Recomputing from the rows that are actually applied is
 * always right by construction.
 *
 * Reversed applications are excluded everywhere, which is why the balances here
 * agree with `payment_intents.received_amount_cents`.
 */

export interface Instalment {
  /** 1-based position among the payments still applied to this intent. */
  sequence: number
  incomingPaymentId: string
  trxId: string | null
  senderMsisdn: string | null
  amountCents: number
  /** Total applied up to and including this one. */
  runningTotalCents: number
  /** Still owed after this one. Zero on the payment that completes the order. */
  outstandingAfterCents: number
  occurredAt: string | null
  appliedAt: string
  matchConfidence: string
  matchedBy: string
}

export interface InstalmentLedger {
  intentAmountCents: number
  receivedCents: number
  outstandingCents: number
  excessCents: number
  /** More than one payment settled, or is settling, this order. */
  split: boolean
  instalments: Instalment[]
}

export async function getInstalments(
  intentId: string,
  amountCents: number,
  client: Database | Tx = db,
): Promise<InstalmentLedger> {
  const rows = await client
    .select({
      incomingPaymentId: orderPayments.incomingPaymentId,
      appliedCents: orderPayments.appliedCents,
      appliedAt: orderPayments.appliedAt,
      matchConfidence: orderPayments.matchConfidence,
      matchedBy: orderPayments.matchedBy,
      trxId: incomingPayments.trxId,
      senderMsisdn: incomingPayments.senderMsisdn,
      occurredAt: incomingPayments.occurredAt,
    })
    .from(orderPayments)
    .innerJoin(incomingPayments, eq(incomingPayments.id, orderPayments.incomingPaymentId))
    .where(and(eq(orderPayments.intentId, intentId), isNull(orderPayments.reversedAt)))
    // Applied order, not the order the money was sent in. What matters for the
    // running balance is when each payment was counted against this intent.
    .orderBy(asc(orderPayments.appliedAt))

  let running = 0
  const instalments = rows.map((row, index): Instalment => {
    running += row.appliedCents
    return {
      sequence: index + 1,
      incomingPaymentId: row.incomingPaymentId,
      trxId: row.trxId,
      senderMsisdn: row.senderMsisdn,
      amountCents: row.appliedCents,
      runningTotalCents: running,
      outstandingAfterCents: Math.max(0, amountCents - running),
      occurredAt: row.occurredAt?.toISOString() ?? null,
      appliedAt: row.appliedAt.toISOString(),
      matchConfidence: row.matchConfidence,
      matchedBy: row.matchedBy,
    }
  })

  return {
    intentAmountCents: amountCents,
    receivedCents: running,
    outstandingCents: Math.max(0, amountCents - running),
    excessCents: Math.max(0, running - amountCents),
    split: instalments.length > 1,
    instalments,
  }
}
