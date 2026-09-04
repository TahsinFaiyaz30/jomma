import { createHash } from 'node:crypto'
import { fromPublicId, toPublicId } from '@jomma/shared'
import { env } from '@jomma/shared/env'
import { and, desc, eq, sql } from 'drizzle-orm'
import { ApiError } from '@/lib/api/errors'
import type { CreateIntentInput } from '@/lib/api/schemas'
import { db } from '@/lib/db/client'
import { idempotencyKeys, paymentIntents, paymentRefs } from '@/lib/db/schema'
import { listAccountHealth, routableAccounts } from './accounts'
import { audit } from './audit'
import { queueEvent } from './events'
import { getInstalments } from './instalments'
import {
  allocateRefCode,
  expireRefCode,
  extendRefCode,
  isUniqueViolation,
  RefPoolExhausted,
} from './refs'
import { secondsFromNow } from './time'

/**
 * The intent lifecycle.
 *
 * Creation is the only genuinely difficult one: it has to pick a healthy
 * account, take an exclusive claim on (account, amount), and allocate a
 * reference code, with every one of those able to lose a race to a concurrent
 * request.
 */

export interface IntentView {
  id: string
  status: string
  amount: number
  received_amount: number
  ref_code: string | null
  receiving_account: { provider: string; msisdn: string; display_name: string }
  client_reference: string
  /**
   * Every payment that settled this intent, in the order they were applied.
   *
   * More than one is normal — a buyer can send part and then the rest. Each
   * carries its position and what was still owed after it, so a client can
   * render the sequence without recomputing the arithmetic and getting a
   * different answer than the dashboard.
   */
  payments: Array<{
    sequence: number
    trx_id: string | null
    sender_msisdn: string | null
    amount: number
    running_total: number
    outstanding_after: number
    occurred_at: string | null
    applied_at: string
    match_confidence: string
    matched_by: string
  }>
  /** True when more than one payment went into it. */
  split: boolean
  shortfall: number
  excess: number
  metadata: Record<string, unknown>
  expires_at: string
  created_at: string
}

/* ── Create ───────────────────────────────────────────────────────────────── */

export async function createIntent(options: {
  appId: string
  input: CreateIntentInput
  idempotencyKey: string | null
  requestId: string
}): Promise<{ intent: IntentView; replayed: boolean }> {
  const config = env()
  const ttlSeconds = options.input.ttl_seconds ?? config.INTENT_DEFAULT_TTL_SECONDS
  const requestHash = hashRequest(options.input)

  if (options.idempotencyKey) {
    const replay = await replayIdempotent(options.appId, options.idempotencyKey, requestHash)
    if (replay) return { intent: replay, replayed: true }
  }

  const accounts = await listAccountHealth()
  if (accounts.length === 0 || accounts.every((account) => account.status === 'disabled')) {
    throw ApiError.noHealthyAccount()
  }

  const eligible = routableAccounts(accounts, options.input.provider)
  if (eligible.length === 0) {
    // Every account is disabled, degraded, drifting, stale, or over its limit.
    // The client must not show a pay page in this state.
    throw ApiError.noHealthyAccount()
  }

  /*
   * Try each healthy account in routing order.
   *
   * There used to be an exclusive claim on (account, amount) here, so two
   * buyers could never be asked for the same number of taka on the same number
   * at once. That existed because the amount was how a reference-less payment
   * got identified — and it is gone, along with the thing it protected. The
   * reference and the sender identify a payment now, so two customers buying
   * the same product at the same price are perfectly distinguishable and there
   * is nothing to hold.
   *
   * Keeping it would have meant the third customer to want a ৳500 item could
   * not check out at all, which is not a trade-off, it is a bug.
   *
   * The loop remains because reference-code allocation can still lose a race,
   * and because falling through to another account is the right answer when the
   * first is momentarily out of codes.
   */
  for (const account of eligible) {
    try {
      const created = await db.transaction(async (tx) => {
        const now = new Date()
        const expiresAt = secondsFromNow(ttlSeconds, now)

        const [intent] = await tx
          .insert(paymentIntents)
          .values({
            appId: options.appId,
            receivingAccountId: account.id,
            amountCents: options.input.amount,
            clientReference: options.input.client_reference,
            payerMsisdn: options.input.payer_msisdn ?? null,
            providerPreference: options.input.provider,
            returnUrl: options.input.return_url ?? null,
            cancelUrl: options.input.cancel_url ?? null,
            metadata: options.input.metadata ?? {},
            ttlSeconds,
            expiresAt,
            payClickedAt: now,
          })
          .returning()
        if (!intent) throw new Error('Insert returned no intent')

        const refCode = await allocateRefCode(tx, intent.id, expiresAt)

        await audit(tx, {
          action: 'intent.created',
          actorType: 'client',
          appId: options.appId,
          intentId: intent.id,
          requestId: options.requestId,
          payload: {
            amount_cents: options.input.amount,
            client_reference: options.input.client_reference,
            ref_code: refCode,
            receiving_account_id: account.id,
            ttl_seconds: ttlSeconds,
          },
        })

        if (options.idempotencyKey) {
          await tx.insert(idempotencyKeys).values({
            appId: options.appId,
            key: options.idempotencyKey,
            endpoint: 'POST /v1/intents',
            requestHash,
            status: 'completed',
            responseStatus: 201,
            responseBody: { intent_id: intent.id },
            // 24h replay window, per docs/api.md.
            expiresAt: secondsFromNow(86_400, now),
          })
        }

        return intent.id
      })

      const view = await getIntentView(created)
      if (!view) throw new Error('Intent vanished immediately after creation')
      return { intent: view, replayed: false }
    } catch (error) {
      if (isUniqueViolation(error)) {
        /*
         * The idempotency key, now that there is no amount lock to collide on.
         * A concurrent request with the same key won the race — replay its
         * result rather than allocating a second reference code.
         */
        if (options.idempotencyKey) {
          const replay = await replayIdempotent(options.appId, options.idempotencyKey, requestHash)
          if (replay) return { intent: replay, replayed: true }
        }
        continue
      }
      if (error instanceof RefPoolExhausted) continue
      throw error
    }
  }

  // Only one way to get here now: every eligible account was momentarily out of
  // reference codes. Rare, and it clears on its own as open intents settle.
  throw ApiError.noCapacity('The reference code pool is momentarily exhausted. Retry shortly.')
}

/** Same key, same body, inside 24h -> the original intent, not a second code. */
async function replayIdempotent(
  appId: string,
  key: string,
  requestHash: string,
): Promise<IntentView | null> {
  const record = await db.query.idempotencyKeys.findFirst({
    where: and(eq(idempotencyKeys.appId, appId), eq(idempotencyKeys.key, key)),
  })

  if (!record) return null
  if (record.expiresAt <= new Date()) return null

  if (record.requestHash !== requestHash) {
    throw new ApiError(
      'validation_failed',
      'This Idempotency-Key was already used with a different request body.',
    )
  }

  const intentId = (record.responseBody as { intent_id?: string } | null)?.intent_id
  if (!intentId) return null
  return getIntentView(intentId)
}

function hashRequest(input: CreateIntentInput): string {
  // Key order is fixed here rather than relying on JSON.stringify's insertion
  // order, so the same logical request always hashes the same.
  const canonical = JSON.stringify({
    amount: input.amount,
    client_reference: input.client_reference,
    payer_msisdn: input.payer_msisdn ?? null,
    provider: input.provider,
    ttl_seconds: input.ttl_seconds ?? null,
    metadata: input.metadata ?? {},
  })
  return createHash('sha256').update(canonical).digest('hex')
}

/* ── Read ─────────────────────────────────────────────────────────────────── */

export async function getIntentView(intentId: string): Promise<IntentView | null> {
  const intent = await db.query.paymentIntents.findFirst({
    where: eq(paymentIntents.id, intentId),
    with: { receivingAccount: true },
  })
  if (!intent) return null

  const ref = await db.query.paymentRefs.findFirst({
    where: eq(paymentRefs.intentId, intentId),
    orderBy: desc(paymentRefs.createdAt),
  })

  const ledger = await getInstalments(intentId, intent.amountCents)

  return {
    id: toPublicId('intent', intent.id),
    status: intent.status,
    amount: intent.amountCents,
    received_amount: intent.receivedAmountCents,
    ref_code: ref?.code ?? null,
    receiving_account: {
      provider: intent.receivingAccount.provider,
      msisdn: intent.receivingAccount.msisdn,
      display_name: intent.receivingAccount.label,
    },
    client_reference: intent.clientReference,
    split: ledger.split,
    payments: ledger.instalments.map((row) => ({
      sequence: row.sequence,
      trx_id: row.trxId,
      sender_msisdn: row.senderMsisdn,
      amount: row.amountCents,
      running_total: row.runningTotalCents,
      outstanding_after: row.outstandingAfterCents,
      occurred_at: row.occurredAt,
      applied_at: row.appliedAt,
      match_confidence: row.matchConfidence,
      matched_by: row.matchedBy,
    })),
    shortfall: Math.max(0, intent.amountCents - intent.receivedAmountCents),
    excess: Math.max(0, intent.receivedAmountCents - intent.amountCents),
    metadata: intent.metadata,
    expires_at: intent.expiresAt.toISOString(),
    created_at: intent.createdAt.toISOString(),
  }
}

/**
 * Resolves a public id and enforces tenancy in one step. A valid intent
 * belonging to another app is a 403, an unknown one is a 404 — leaking the
 * difference would let a caller probe for other tenants' ids.
 */
export async function requireIntent(publicId: string, appId: string) {
  const uuid = fromPublicId('intent', publicId)
  if (!uuid) throw ApiError.notFound()

  const intent = await db.query.paymentIntents.findFirst({
    where: eq(paymentIntents.id, uuid),
  })
  if (!intent) throw ApiError.notFound()
  if (intent.appId !== appId) throw ApiError.forbidden()
  return intent
}

/* ── Cancel ───────────────────────────────────────────────────────────────── */

/** Idempotent: cancelling an already-cancelled intent is a success, not a 409. */
export async function cancelIntent(options: {
  intentId: string
  appId: string
  requestId: string
  actorId?: string | null
}): Promise<IntentView> {
  await db.transaction(async (tx) => {
    const now = new Date()

    const [updated] = await tx
      .update(paymentIntents)
      .set({ status: 'cancelled', cancelledAt: now })
      .where(and(eq(paymentIntents.id, options.intentId), eq(paymentIntents.status, 'open')))
      .returning({
        id: paymentIntents.id,
        clientReference: paymentIntents.clientReference,
      })

    if (!updated) return

    await expireRefCode(tx, options.intentId)

    await audit(tx, {
      action: 'intent.cancelled',
      actorId: options.actorId ?? null,
      actorType: options.actorId ? 'admin' : 'client',
      appId: options.appId,
      intentId: options.intentId,
      requestId: options.requestId,
    })

    const intent = await tx.query.paymentIntents.findFirst({
      where: eq(paymentIntents.id, options.intentId),
    })
    if (!intent) return

    await queueEvent(tx, {
      appId: options.appId,
      type: 'payment.cancelled',
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
      },
    })
  })

  const view = await getIntentView(options.intentId)
  if (!view) throw ApiError.notFound()
  return view
}

/* ── Extend ───────────────────────────────────────────────────────────────── */

/**
 * Holds an order while a buyer tops up an underpayment.
 *
 * Used to be able to fail with `lock_taken`, when another intent had claimed
 * the same amount on the same account in the meantime. There are no amount
 * claims any more, so extending is now only refused for the intent's own state.
 */
export async function extendIntent(options: {
  intentId: string
  appId: string
  ttlSeconds: number
  requestId: string
}): Promise<IntentView> {
  await db.transaction(async (tx) => {
    const now = new Date()
    const expiresAt = secondsFromNow(options.ttlSeconds, now)

    const intent = await tx.query.paymentIntents.findFirst({
      where: eq(paymentIntents.id, options.intentId),
    })
    if (!intent) throw ApiError.notFound()

    if (intent.status !== 'open' && intent.status !== 'partial' && intent.status !== 'expired') {
      throw ApiError.lockTaken(`An intent in status "${intent.status}" cannot be extended.`)
    }

    await tx
      .update(paymentIntents)
      .set({
        expiresAt,
        ttlSeconds: options.ttlSeconds,
        status: intent.status === 'expired' ? 'open' : intent.status,
        expiredAt: null,
      })
      .where(eq(paymentIntents.id, options.intentId))

    await extendRefCode(tx, options.intentId, expiresAt)

    await audit(tx, {
      action: 'intent.extended',
      actorType: 'client',
      appId: options.appId,
      intentId: options.intentId,
      requestId: options.requestId,
      payload: {
        ttl_seconds: options.ttlSeconds,
        expires_at: expiresAt.toISOString(),
      },
    })
  })

  const view = await getIntentView(options.intentId)
  if (!view) throw ApiError.notFound()
  return view
}

/* ── Expiry ───────────────────────────────────────────────────────────────── */

/**
 * The sweep. Called by the worker, and inline by the read path so a client
 * polling `GET /v1/intents/:id` never sees a stale `open`.
 */
export async function expireDueIntents(limit = 200): Promise<number> {
  const due = await db
    .select({ id: paymentIntents.id, appId: paymentIntents.appId })
    .from(paymentIntents)
    .where(and(eq(paymentIntents.status, 'open'), sql`${paymentIntents.expiresAt} <= now()`))
    .limit(limit)

  let expired = 0

  for (const row of due) {
    await db.transaction(async (tx) => {
      const now = new Date()
      const [updated] = await tx
        .update(paymentIntents)
        .set({ status: 'expired', expiredAt: now })
        .where(and(eq(paymentIntents.id, row.id), eq(paymentIntents.status, 'open')))
        .returning()

      if (!updated) return
      expired += 1

      await expireRefCode(tx, row.id)

      await audit(tx, {
        action: 'intent.expired',
        appId: row.appId,
        intentId: row.id,
        payload: { amount_cents: updated.amountCents },
      })

      await queueEvent(tx, {
        appId: row.appId,
        type: 'payment.expired',
        data: {
          intent_id: toPublicId('intent', updated.id),
          client_reference: updated.clientReference,
          amount: updated.amountCents,
          received_amount: updated.receivedAmountCents,
          trx_id: null,
          sender_msisdn: null,
          match_confidence: null,
          matched_by: null,
          metadata: updated.metadata,
        },
      })
    })
  }

  return expired
}
