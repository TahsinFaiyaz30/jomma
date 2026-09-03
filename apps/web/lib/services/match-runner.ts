import { env } from '@jomma/shared/env'
import { and, eq, isNull, or, sql } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { amountLocks, incomingPayments, paymentIntents, paymentRefs } from '@/lib/db/schema'
import { logger } from '@/lib/logger'
import type { CandidateIntent, MatchResult, ObservedPayment } from '@/lib/matching'
import { resolveMatch } from '@/lib/matching'
import { applyPayment, LockRaceError } from './apply'
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
async function loadCandidates(
  receivingAccountId: string,
  amountCents: number,
): Promise<CandidateIntent[]> {
  const rows = await db
    .select({
      intent: paymentIntents,
      refCode: paymentRefs.code,
      lock: amountLocks,
    })
    .from(paymentIntents)
    .leftJoin(
      paymentRefs,
      and(eq(paymentRefs.intentId, paymentIntents.id), eq(paymentRefs.status, 'open')),
    )
    .leftJoin(
      amountLocks,
      and(eq(amountLocks.intentId, paymentIntents.id), eq(amountLocks.status, 'active')),
    )
    .where(
      and(
        eq(paymentIntents.receivingAccountId, receivingAccountId),
        or(
          and(eq(paymentIntents.status, 'open'), eq(paymentIntents.amountCents, amountCents)),
          and(
            eq(paymentIntents.status, 'partial'),
            sql`${paymentIntents.amountCents} - ${paymentIntents.receivedAmountCents} = ${amountCents}`,
          ),
        ),
      ),
    )

  return rows.map(({ intent, refCode, lock }) => ({
    id: intent.id,
    receivingAccountId: intent.receivingAccountId,
    amountCents: intent.amountCents,
    outstandingCents: intent.amountCents - intent.receivedAmountCents,
    refCode,
    expectedMsisdn: intent.payerMsisdn,
    payClickedAt: intent.payClickedAt,
    expiresAt: intent.expiresAt,
    status: intent.status,
    lock: lock
      ? {
          id: lock.id,
          receivingAccountId: lock.receivingAccountId,
          amountCents: lock.amountCents,
          status: lock.status,
          expiresAt: lock.expiresAt,
        }
      : null,
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
  }

  const candidates =
    payment.amountCents === null
      ? []
      : await loadCandidates(payment.receivingAccountId, payment.amountCents)

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

  try {
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
  } catch (error) {
    if (error instanceof LockRaceError) {
      // Another approval got there first. Not an error worth surfacing — the
      // payment stays unmatched and the next pass re-evaluates it.
      logger.warn({ incomingPaymentId: payment.id }, 'lost the lock race; leaving unmatched')
      return { result, applied: false, intentId: null }
    }
    throw error
  }

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
