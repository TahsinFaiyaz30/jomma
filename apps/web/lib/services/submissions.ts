import type { IntentStatus, SubmissionResolution, SubmissionStatus } from '@jomma/shared'
import { and, count, desc, eq, gte, isNull } from 'drizzle-orm'
import { ApiError } from '@/lib/api/errors'
import { db } from '@/lib/db/client'
import {
  incomingPayments,
  orderPayments,
  paymentIntents,
  paymentRefs,
  paymentSubmissions,
  type receivingAccounts,
} from '@/lib/db/schema'
import { sameMsisdn } from '@/lib/matching'
import { AlreadyAppliedError, applyPayment, LockRaceError } from './apply'
import { audit } from './audit'
import { minutesAgo } from './time'

/**
 * The manual path: a buyer types a TrxID because automatic matching didn't fire.
 *
 * Nine outcomes, from docs/api.md and docs/matching.md. Jomma returns the
 * resolution and the numbers; the client renders the words. Deliberately no
 * user-facing copy in here — different clients word things differently, and a
 * string baked in at this layer becomes every client's string.
 */

/** An intent younger than this gets "keep waiting" rather than "we can't find it". */
export const RECENT_INTENT_MINUTES = 10

/** Fraud control, not traffic control — counted in the database, not in memory. */
export const MAX_SUBMISSIONS_PER_INTENT_PER_HOUR = 5

/** Escalate to the manual queue after this many fruitless attempts. */
export const ESCALATE_AFTER_ATTEMPTS = 3

export interface SubmissionResult {
  resolution: SubmissionResolution
  intent_status: IntentStatus
  received_amount?: number
  shortfall?: number
  excess?: number
  top_up?: {
    amount: number
    ref_code: string | null
    receiving_msisdn: string
  }
}

export async function resolveSubmission(options: {
  intentId: string
  appId: string
  trxId: string
  senderMsisdn: string | null
  claimedAmountCents: number | null
  ip: string | null
  requestId: string
}): Promise<SubmissionResult> {
  await enforcePerIntentLimit(options.intentId)

  const intent = await db.query.paymentIntents.findFirst({
    where: eq(paymentIntents.id, options.intentId),
    with: { receivingAccount: true },
  })
  if (!intent) throw ApiError.notFound()

  /*
   * Scoped to this intent's receiving account, not just the TrxID.
   *
   * The automatic matcher gates on the receiving account — it only ever loads
   * candidates for the account the payment landed on. This path has to gate the
   * same way, from the other direction, or the two disagree: a TrxID for money
   * that arrived on a different account, or on a different provider entirely,
   * would be credited to this intent purely because the number was quoted.
   *
   * The money is the merchant's either way, so this is not theft — but it would
   * satisfy an amount lock held on one account with money that arrived on
   * another, and it would let a buyer pay by a method they did not select. Both
   * corrupt per-account reconciliation and balance continuity.
   *
   * Out of scope means genuinely not found *for this intent*, which is an
   * existing resolution that escalates to a human after three attempts. A real
   * payment sitting on the wrong account is then applied by an admin from the
   * queue, with the account mismatch visible.
   */
  const payment = await db.query.incomingPayments.findFirst({
    where: and(
      eq(incomingPayments.trxId, options.trxId),
      eq(incomingPayments.receivingAccountId, intent.receivingAccountId),
    ),
  })

  const outcome = payment
    ? await resolveFound(intent, payment, options)
    : await resolveNotFound(intent, options)

  await record({
    ...options,
    ...outcome,
    paymentId: payment?.id ?? null,
    intent,
  })

  return outcome.response
}

/* ── Outcomes 1 and 2: nothing observed ───────────────────────────────────── */

async function resolveNotFound(
  intent: typeof paymentIntents.$inferSelect,
  options: { intentId: string },
): Promise<Outcome> {
  const recent = intent.createdAt > minutesAgo(RECENT_INTENT_MINUTES)

  if (recent) {
    // Under ten minutes old. It usually takes well under a minute; do not let
    // the buyer think it failed.
    return {
      resolution: 'not_found_recent',
      status: 'pending',
      response: {
        resolution: 'not_found_recent',
        intent_status: intent.status,
      },
    }
  }

  const [attempts] = await db
    .select({ value: count() })
    .from(paymentSubmissions)
    .where(
      and(
        eq(paymentSubmissions.intentId, options.intentId),
        eq(paymentSubmissions.resolution, 'not_found_stale'),
      ),
    )

  const escalate = (attempts?.value ?? 0) + 1 >= ESCALATE_AFTER_ATTEMPTS

  return {
    resolution: 'not_found_stale',
    status: 'pending',
    escalated: escalate,
    response: { resolution: 'not_found_stale', intent_status: intent.status },
  }
}

/* ── Outcomes 3 to 9: something was observed ──────────────────────────────── */

async function resolveFound(
  intent: typeof paymentIntents.$inferSelect & {
    receivingAccount: typeof receivingAccounts.$inferSelect
  },
  payment: typeof incomingPayments.$inferSelect,
  options: {
    intentId: string
    senderMsisdn: string | null
    requestId: string
  },
): Promise<Outcome> {
  // 3. Already spent. Never approve, and log both intents — this is either an
  //    honest mistake or a fraud attempt, and you want the record either way.
  const existing = await db.query.orderPayments.findFirst({
    where: and(eq(orderPayments.incomingPaymentId, payment.id), isNull(orderPayments.reversedAt)),
  })

  if (existing && existing.intentId !== intent.id) {
    await db.transaction(async (tx) => {
      await audit(tx, {
        action: 'submission.resolved',
        actorType: 'client',
        appId: intent.appId,
        intentId: intent.id,
        incomingPaymentId: payment.id,
        requestId: options.requestId,
        payload: {
          resolution: 'already_used',
          claimed_by_intent_id: intent.id,
          already_applied_to_intent_id: existing.intentId,
        },
      })
    })

    return {
      resolution: 'already_used',
      status: 'rejected',
      response: { resolution: 'already_used', intent_status: intent.status },
    }
  }

  // Re-submitting a TrxID already applied to this same intent is idempotent.
  if (existing && existing.intentId === intent.id) {
    return {
      resolution: 'exact',
      status: 'approved',
      response: { resolution: 'exact', intent_status: intent.status },
    }
  }

  // 8. An agent cash-in or a type the parser could not classify. Route to a
  //    human — unusual transaction types are never auto-approved.
  if (payment.transactionType !== 'send_money') {
    return {
      resolution: 'wrong_type',
      status: 'pending',
      escalated: true,
      response: { resolution: 'wrong_type', intent_status: intent.status },
    }
  }

  // 9. The intent already expired. The money is real, so this is a revival
  //    question for a human, not a rejection.
  if (intent.status === 'expired' || intent.status === 'cancelled') {
    return {
      resolution: 'expired_intent',
      status: 'pending',
      escalated: true,
      response: { resolution: 'expired_intent', intent_status: intent.status },
    }
  }

  if (payment.amountCents === null) {
    return {
      resolution: 'wrong_type',
      status: 'pending',
      escalated: true,
      response: { resolution: 'wrong_type', intent_status: intent.status },
    }
  }

  const outstanding = intent.amountCents - intent.receivedAmountCents
  const senderMatches = sameMsisdn(payment.senderMsisdn, intent.payerMsisdn ?? options.senderMsisdn)

  /*
   * The sender is a requirement, checked before anything else.
   *
   * It used to be a tiebreak that only ran when the amount matched exactly —
   * so a short or over payment from a number nobody declared was applied
   * without the sender ever being looked at. That is the same hole the
   * automatic path had, from the other direction.
   *
   * A mismatch is not a rejection. The money is real and it is on the right
   * account, so refusing it would strand it; somebody paying from a spouse's
   * account is an ordinary thing to do. It goes to a human, who can see both
   * numbers and decide, and until they do it is not credited to anyone.
   */
  if (!senderMatches) {
    return {
      resolution: 'sender_mismatch',
      status: 'pending',
      escalated: true,
      response: { resolution: 'sender_mismatch', intent_status: intent.status },
    }
  }

  // 4, 5, 6 all record the money. Underpayment is held, not lost.
  const resolution: SubmissionResolution =
    payment.amountCents < outstanding
      ? 'underpaid'
      : payment.amountCents > outstanding
        ? 'overpaid'
        : 'exact'

  let applied: Awaited<ReturnType<typeof applyPayment>>
  try {
    applied = await db.transaction((tx) =>
      applyPayment(tx, {
        intentId: intent.id,
        incomingPaymentId: payment.id,
        appliedCents: payment.amountCents as number,
        // The TrxID alone is strong evidence: it is system-generated and the
        // buyer could only know it by having made the payment.
        confidence: 'manual',
        matchedBy: 'submission',
        requestId: options.requestId,
      }),
    )
  } catch (error) {
    if (error instanceof AlreadyAppliedError) throw ApiError.duplicateSubmission()
    if (error instanceof LockRaceError) throw ApiError.lockTaken()
    throw error
  }

  const ref = await db.query.paymentRefs.findFirst({
    where: and(eq(paymentRefs.intentId, intent.id), eq(paymentRefs.status, 'open')),
    orderBy: desc(paymentRefs.createdAt),
  })

  const response: SubmissionResult = {
    resolution,
    intent_status: applied.intentStatus,
    received_amount: applied.receivedCents,
  }

  if (resolution === 'underpaid') {
    response.shortfall = applied.shortfallCents
    response.top_up = {
      amount: applied.shortfallCents,
      ref_code: ref?.code ?? null,
      receiving_msisdn: intent.receivingAccount.msisdn,
    }
  }

  if (resolution === 'overpaid') {
    response.excess = applied.excessCents
  }

  return { resolution, status: 'approved', response }
}

/* ── Bookkeeping ──────────────────────────────────────────────────────────── */

interface Outcome {
  resolution: SubmissionResolution
  status: SubmissionStatus
  escalated?: boolean
  flagged?: boolean
  response: SubmissionResult
}

async function record(
  options: Outcome & {
    intentId: string
    appId: string
    trxId: string
    senderMsisdn: string | null
    claimedAmountCents: number | null
    ip: string | null
    requestId: string
    paymentId: string | null
    intent: typeof paymentIntents.$inferSelect
  },
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.insert(paymentSubmissions).values({
      intentId: options.intentId,
      appId: options.appId,
      trxId: options.trxId,
      senderMsisdn: options.senderMsisdn,
      claimedAmountCents: options.claimedAmountCents,
      status: options.status,
      resolution: options.resolution,
      incomingPaymentId: options.paymentId,
      ip: options.ip,
      note: options.flagged ? 'sender_mismatch' : options.escalated ? 'escalated_to_queue' : null,
    })

    await audit(tx, {
      action: 'submission.created',
      actorType: 'client',
      appId: options.appId,
      intentId: options.intentId,
      incomingPaymentId: options.paymentId,
      requestId: options.requestId,
      payload: {
        resolution: options.resolution,
        status: options.status,
        escalated: options.escalated ?? false,
        flagged: options.flagged ?? false,
      },
    })
  })
}

/**
 * 5 per intent per hour. Counted against the table rather than an in-memory
 * bucket: this is a brute-force defence, and a defence that resets on deploy is
 * not a defence.
 */
async function enforcePerIntentLimit(intentId: string): Promise<void> {
  const [recent] = await db
    .select({ value: count() })
    .from(paymentSubmissions)
    .where(
      and(
        eq(paymentSubmissions.intentId, intentId),
        gte(paymentSubmissions.createdAt, minutesAgo(60)),
      ),
    )

  if ((recent?.value ?? 0) >= MAX_SUBMISSIONS_PER_INTENT_PER_HOUR) {
    throw ApiError.rateLimited(3600, 'Too many verification attempts for this payment request.')
  }
}
