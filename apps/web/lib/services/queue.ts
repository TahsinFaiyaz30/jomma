import 'server-only'

import type { TransactionType } from '@jomma/shared'
import { and, asc, eq, isNull, ne, or } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { incomingPayments, paymentIntents, paymentRefs, receivingAccounts } from '@/lib/db/schema'
import type { CandidateIntent, ObservedPayment } from '@/lib/matching'
import { type CandidateDiagnosis, diagnoseCandidates } from '@/lib/matching'
import { applyPayment } from './apply'
import { audit } from './audit'

/**
 * The manual queue: payments the matcher refused to guess at, oldest first.
 *
 * Age is the priority, not amount. A buyer who paid twenty minutes ago and is
 * staring at a pending page is the problem; a large payment that arrived one
 * minute ago is not yet.
 */

export interface QueueCandidate {
  intentId: string
  publicIntentId: string
  clientReference: string
  appName: string
  amountCents: number
  outstandingCents: number
  refCode: string | null
  expectedMsisdn: string | null
  status: string
  createdAt: string
  expiresAt: string
  diagnosis: Omit<CandidateDiagnosis, 'intent'>
}

export interface QueueItem {
  paymentId: string
  receivedAt: string
  amountCents: number | null
  senderMsisdn: string | null
  trxId: string | null
  reference: string | null
  rawMessage: string
  parseStatus: 'ok' | 'partial' | 'failed'
  parseError: string | null
  transactionType: TransactionType | null
  source: string
  accountLabel: string
  accountProvider: 'bkash' | 'nagad'
  /** Why it landed here, in the operator's words. */
  reason: string
  candidates: QueueCandidate[]
}

function reasonFor(
  payment: { parseStatus: string; transactionType: string | null; amountCents: number | null },
  candidates: QueueCandidate[],
): string {
  if (payment.parseStatus === 'failed') return 'Message could not be parsed'
  if (payment.amountCents === null) return 'No amount could be read'
  if (payment.transactionType && payment.transactionType !== 'send_money') {
    return `Transaction type is ${payment.transactionType}, not a send-money`
  }
  if (candidates.length === 0) return 'No open intent matches this amount'

  const clearing = candidates.filter((candidate) => !candidate.diagnosis.gated)
  if (clearing.length === 0) return 'No candidate matches the amount exactly'
  if (clearing.length > 1) return `${clearing.length} candidates scored too closely to choose`
  return 'Scored below the automatic threshold'
}

export async function getQueue(businessId: string, limit = 100): Promise<QueueItem[]> {
  const payments = await db
    .select({
      payment: incomingPayments,
      accountLabel: receivingAccounts.label,
      accountProvider: receivingAccounts.provider,
    })
    .from(incomingPayments)
    .innerJoin(receivingAccounts, eq(incomingPayments.receivingAccountId, receivingAccounts.id))
    .where(
      and(
        eq(receivingAccounts.businessId, businessId),
        or(
          eq(incomingPayments.status, 'unmatched'),
          eq(incomingPayments.status, 'orphaned'),
          eq(incomingPayments.parseStatus, 'failed'),
        ),
        /*
         * A cash-in or an outgoing transfer is stored because the operator
         * switched it on to keep a record, and it is permanently `unmatched`
         * because nothing else is possible — `resolve.ts` admits `send_money`
         * alone. Listing it here would put a row in the review queue that can
         * never be worked, on every single one, for as long as the setting is
         * on.
         *
         * A failed parse is still listed whatever its apparent type, because
         * "apparent type" is exactly what is not trustworthy about it.
         */
        or(
          eq(incomingPayments.parseStatus, 'failed'),
          isNull(incomingPayments.transactionType),
          eq(incomingPayments.transactionType, 'send_money'),
        ),
      ),
    )
    // Oldest first. The queue is worked from the top.
    .orderBy(asc(incomingPayments.receivedAt))
    .limit(limit)

  if (payments.length === 0) return []

  const items: QueueItem[] = []

  for (const { payment, accountLabel, accountProvider } of payments) {
    const observed: ObservedPayment = {
      id: payment.id,
      receivingAccountId: payment.receivingAccountId,
      amountCents: payment.amountCents,
      senderMsisdn: payment.senderMsisdn,
      referenceRaw: payment.referenceRaw,
      transactionType: payment.transactionType,
      receivedAt: payment.receivedAt,
      occurredAt: payment.occurredAt,
    }

    /*
     * Every still-claimable intent on this account, not just ones at a matching
     * amount. The whole point of the queue is seeing the near-misses the scorer
     * threw away.
     */
    const rows = await db
      .select({
        intent: paymentIntents,
        refCode: paymentRefs.code,
        appName: paymentIntents.clientReference,
      })
      .from(paymentIntents)
      .leftJoin(
        paymentRefs,
        and(eq(paymentRefs.intentId, paymentIntents.id), eq(paymentRefs.status, 'open')),
      )
      .where(
        and(
          eq(paymentIntents.receivingAccountId, payment.receivingAccountId),
          ne(paymentIntents.status, 'cancelled'),
          ne(paymentIntents.status, 'matched'),
        ),
      )
      .limit(40)

    const candidateIntents: CandidateIntent[] = rows.map(({ intent, refCode }) => ({
      id: intent.id,
      receivingAccountId: intent.receivingAccountId,
      amountCents: intent.amountCents,
      outstandingCents: intent.amountCents - intent.receivedAmountCents,
      refCode,
      expectedMsisdn: intent.payerMsisdn,
      payClickedAt: intent.payClickedAt,
      expiresAt: intent.expiresAt,
      status: intent.status,
    }))

    const byId = new Map(rows.map((row) => [row.intent.id, row.intent]))

    const candidates: QueueCandidate[] = diagnoseCandidates(observed, candidateIntents)
      // Anything more than one edit away with a wrong amount is noise, not a
      // candidate. Showing forty rows per payment makes the queue unusable.
      .filter(
        (d) =>
          d.amountDeltaCents === 0 ||
          (d.referenceDistance !== null && d.referenceDistance <= 2) ||
          d.senderMatches,
      )
      .slice(0, 6)
      .map(({ intent, ...diagnosis }) => {
        const row = byId.get(intent.id)
        return {
          intentId: intent.id,
          publicIntentId: intent.id,
          clientReference: row?.clientReference ?? '—',
          appName: row?.clientReference ?? '—',
          amountCents: intent.amountCents,
          outstandingCents: intent.outstandingCents,
          refCode: intent.refCode,
          expectedMsisdn: intent.expectedMsisdn,
          status: intent.status,
          createdAt: (row?.createdAt ?? intent.payClickedAt).toISOString(),
          expiresAt: intent.expiresAt.toISOString(),
          diagnosis,
        }
      })

    items.push({
      paymentId: payment.id,
      receivedAt: payment.receivedAt.toISOString(),
      amountCents: payment.amountCents,
      senderMsisdn: payment.senderMsisdn,
      trxId: payment.trxId,
      reference: payment.referenceNormalized,
      rawMessage: payment.rawMessage,
      parseStatus: payment.parseStatus,
      parseError: payment.parseError,
      transactionType: payment.transactionType,
      source: payment.source,
      accountLabel,
      accountProvider,
      reason: reasonFor(payment, candidates),
      candidates,
    })
  }

  return items
}

/**
 * Approving from the queue.
 *
 * Calls straight into `applyPayment` — the same transaction, the same
 * conditional lock update, the same cumulative sum as the automatic path. The
 * only differences are `matchedBy: 'admin'` and a non-null actor, so the audit
 * trail records who decided.
 */
export async function approveFromQueue(options: {
  paymentId: string
  intentId: string
  actorId: string
  requestId?: string
}) {
  const payment = await db.query.incomingPayments.findFirst({
    where: eq(incomingPayments.id, options.paymentId),
  })
  if (!payment) throw new Error('Unknown payment')
  if (payment.amountCents === null) {
    throw new Error('This payment has no readable amount and cannot be applied.')
  }
  if (payment.status === 'matched') throw new Error('This payment is already applied.')

  return db.transaction((tx) =>
    applyPayment(tx, {
      intentId: options.intentId,
      incomingPaymentId: options.paymentId,
      appliedCents: payment.amountCents as number,
      confidence: 'manual',
      matchedBy: 'admin',
      actorId: options.actorId,
      requestId: options.requestId ?? null,
    }),
  )
}

/**
 * Rejecting.
 *
 * Not a delete and not a dismissal — the payment becomes `orphaned`, which keeps
 * it out of the active queue while leaving it visible on Reconcile as money that
 * arrived and nothing claims. Money is never made to disappear from a screen.
 */
export async function rejectFromQueue(options: {
  paymentId: string
  actorId: string
  note?: string | null
  requestId?: string
}) {
  await db.transaction(async (tx) => {
    // Guarded on status, not on trx_id: a parse-failed row has no trx_id and
    // still has to be rejectable. Refusing to touch an already-applied payment
    // is the guard that matters.
    const [updated] = await tx
      .update(incomingPayments)
      .set({ status: 'orphaned' })
      .where(
        and(eq(incomingPayments.id, options.paymentId), ne(incomingPayments.status, 'matched')),
      )
      .returning({ id: incomingPayments.id })

    if (!updated) {
      throw new Error('This payment is already applied to an intent — reverse it instead.')
    }

    await audit(tx, {
      action: 'payment.orphaned',
      actorId: options.actorId,
      actorType: 'admin',
      incomingPaymentId: options.paymentId,
      requestId: options.requestId ?? null,
      payload: { note: options.note ?? null },
    })
  })
}

/** Puts an orphaned payment back into the working queue. */
export async function restoreToQueue(options: { paymentId: string; actorId: string }) {
  await db.transaction(async (tx) => {
    await tx
      .update(incomingPayments)
      .set({ status: 'unmatched', matchAttempts: 0 })
      .where(eq(incomingPayments.id, options.paymentId))

    await audit(tx, {
      action: 'payment.captured',
      actorId: options.actorId,
      actorType: 'admin',
      incomingPaymentId: options.paymentId,
      payload: { restored: true },
    })
  })
}
