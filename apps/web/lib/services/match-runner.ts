import { env } from '@jomma/shared/env'
import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { incomingPayments, paymentIntents, paymentRefs } from '@/lib/db/schema'
import type { CandidateIntent, MatchResult, ObservedPayment } from '@/lib/matching'
import { normalizeRef, resolveMatch } from '@/lib/matching'
import { applyPayment } from './apply'
import { audit } from './audit'

/**
 * The I/O shell around the pure matcher.
 *
 * Everything that decides anything lives in lib/matching. This module only
 * loads candidates, hands them over, and writes down what came back.
 */

export interface MatchRunResult {
  result: MatchResult
  applied: boolean
  intentId: string | null
}

/** Open and partially-paid intents on the same account whose outstanding balance
    equals what arrived. The gate is re-applied inside the scorer regardless. */
/**
 * Open and part-paid intents this payment could belong to.
 *
 * Two ways in, because there are two ways to be identified:
 *
 * - **By reference.** The code is the identifier, so an intent holding it is a
 *   candidate whatever the amount. This is what lets a part payment match, and
 *   what makes the amount arithmetic rather than a lookup key.
 * - **By amount.** For payments that arrive with no reference at all — bKash's
 *   field is optional and buyers skip it — an exact outstanding balance is the
 *   only identifier available, and the exclusive lock is what makes it one.
 *
 * Loading a candidate is not matching it. Everything here still goes through the
 * scorer, which is where an inexact amount is required to carry an exact code.
 */
async function loadCandidates(
  receivingAccountId: string,
  amountCents: number,
  referenceNormalized: string | null,
): Promise<CandidateIntent[]> {
  const rows = await db
    .select({
      intent: paymentIntents,
      refCode: paymentRefs.code,
    })
    .from(paymentIntents)
    .leftJoin(
      paymentRefs,
      and(eq(paymentRefs.intentId, paymentIntents.id), eq(paymentRefs.status, 'open')),
    )
    .where(
      and(
        eq(paymentIntents.receivingAccountId, receivingAccountId),
        inArray(paymentIntents.status, ['open', 'partial']),
        or(
          // Exactly settles the balance — the reference-less path.
          eq(paymentIntents.amountCents, amountCents),
          sql`${paymentIntents.amountCents} - ${paymentIntents.receivedAmountCents} = ${amountCents}`,
          // Holds the reference this payment quoted, at any amount.
          referenceNormalized
            ? sql`upper(regexp_replace(${paymentRefs.code}, '[^A-Za-z0-9]', '', 'g')) = ${referenceNormalized}`
            : sql`false`,
        ),
      ),
    )

  return rows.map(({ intent, refCode }) => ({
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
}

/**
 * Scores one observed payment against every open intent and applies the result.
 *
 * Safe to call repeatedly: an already-matched payment returns immediately, so
 * the orphan retry loop can run this every 30 seconds without side effects.
 */
export async function runMatcher(incomingPaymentId: string): Promise<MatchRunResult> {
  const config = env()

  const payment = await db.query.incomingPayments.findFirst({
    where: eq(incomingPayments.id, incomingPaymentId),
  })
  if (!payment) throw new Error(`Unknown incoming payment ${incomingPaymentId}`)

  if (payment.status === 'matched' || payment.status === 'refunded') {
    return {
      result: { kind: 'unmatched', reason: 'no_candidates' },
      applied: false,
      intentId: null,
    }
  }

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

  const candidates =
    payment.amountCents === null
      ? []
      : await loadCandidates(
          payment.receivingAccountId,
          payment.amountCents,
          normalizeRef(payment.referenceRaw),
        )

  const result = resolveMatch(observed, candidates, {
    approveThreshold: config.MATCH_APPROVE_THRESHOLD,
    ambiguityMargin: config.MATCH_AMBIGUITY_MARGIN,
  })

  await db
    .update(incomingPayments)
    .set({
      matchAttempts: sql`${incomingPayments.matchAttempts} + 1`,
      lastMatchAttemptAt: new Date(),
    })
    .where(eq(incomingPayments.id, payment.id))

  if (result.kind !== 'matched') {
    // Nothing claims it yet. Leave it `unmatched` so the retry loop and the
    // manual queue can both still reach it — never drop, never guess.
    await db.transaction(async (tx) => {
      await audit(tx, {
        action: result.kind === 'ambiguous' ? 'payment.orphaned' : 'payment.captured',
        incomingPaymentId: payment.id,
        payload: {
          outcome: result.kind,
          reason: result.kind === 'ambiguous' ? result.reason : result.reason,
          candidates:
            result.kind === 'ambiguous'
              ? result.candidates.map((candidate) => ({
                  intent_id: candidate.intent.id,
                  score: candidate.score,
                  signals: candidate.signals,
                }))
              : [],
        },
      })
    })

    return { result, applied: false, intentId: null }
  }

  const winner = result.candidate
  await db.transaction(async (tx) => {
    await applyPayment(tx, {
      intentId: winner.intent.id,
      incomingPaymentId: payment.id,
      appliedCents: payment.amountCents as number,
      confidence: winner.confidence ?? 'lock',
      matchedBy: 'automatic',
      matchScore: winner.score,
    })
  })

  return { result, applied: true, intentId: winner.intent.id }
}

/**
 * Orphan retry, per docs/matching.md: a payment that arrives before its intent
 * commits gets re-matched every 30 seconds for 10 minutes before it is given up
 * to the manual queue.
 */
export async function retryOrphans(limit = 100): Promise<number> {
  const stale = await db
    .select({ id: incomingPayments.id })
    .from(incomingPayments)
    .where(
      and(
        eq(incomingPayments.status, 'unmatched'),
        eq(incomingPayments.parseStatus, 'ok'),
        sql`${incomingPayments.matchAttempts} < 20`,
        sql`${incomingPayments.receivedAt} > now() - interval '10 minutes'`,
        or(
          isNull(incomingPayments.lastMatchAttemptAt),
          sql`${incomingPayments.lastMatchAttemptAt} < now() - interval '30 seconds'`,
        ),
      ),
    )
    .limit(limit)

  let applied = 0
  for (const row of stale) {
    const outcome = await runMatcher(row.id)
    if (outcome.applied) applied += 1
  }
  return applied
}
