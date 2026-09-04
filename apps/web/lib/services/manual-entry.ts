import 'server-only'

import type { CaptureSource, IngestAdapterId, Provider } from '@jomma/shared'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { incomingPayments, notifierEvents, receivingAccounts } from '@/lib/db/schema'
import { logger } from '@/lib/logger'
import { parseMessage } from '@/lib/parsers'
import { audit } from './audit'
import { checkBalanceContinuity } from './balance'
import { runMatcher } from './match-runner'

/**
 * Manual entry — an admin pasting a message straight into the dashboard.
 *
 * AGENTS.md lists this as `secondary` reliability and, crucially, **always
 * available**. It is the path that still works when the phone is dead, the
 * notifier is broken, the parser has been changed by the provider, and the
 * statement has not arrived yet. Somebody reads the message off a screen and
 * types it in, and the money is accounted for.
 *
 * It goes through exactly the same pipeline as a device capture: raw stored
 * first, parsed with the same parser, deduplicated on the same `trx_id`, and
 * matched by the same scorer. The only differences are the source and adapter
 * columns, and that an actor is recorded.
 */

export interface ManualEntryResult {
  status: 'accepted' | 'duplicate' | 'unparsed'
  paymentId: string | null
  trxId: string | null
  amountCents: number | null
  parseError: string | null
  matched: boolean
  intentId: string | null
}

export async function ingestManualEntry(options: {
  receivingAccountId: string
  raw: string
  actorId: string
  requestId?: string
  /** Statement paste and generic webhook reuse this with a different label. */
  source?: CaptureSource
  adapter?: IngestAdapterId
}): Promise<ManualEntryResult> {
  const account = await db.query.receivingAccounts.findFirst({
    where: eq(receivingAccounts.id, options.receivingAccountId),
  })
  if (!account) throw new Error('Unknown receiving account')

  const raw = options.raw.trim()
  if (!raw) throw new Error('Nothing to import.')

  const parsed = parseMessage(account.provider as Provider, raw)
  const receivedAt = new Date()

  const inserted = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(incomingPayments)
      .values({
        receivingAccountId: account.id,
        provider: account.provider as Provider,
        trxId: parsed.trxId,
        senderMsisdn: parsed.senderMsisdn,
        amountCents: parsed.amountCents,
        balanceAfterCents: parsed.balanceAfterCents,
        referenceRaw: parsed.referenceRaw,
        referenceNormalized: parsed.referenceRaw
          ? parsed.referenceRaw.toUpperCase().replace(/[^A-Z0-9]/g, '')
          : null,
        transactionType: parsed.transactionType,
        occurredAt: parsed.occurredAt,
        // Server clock, as always. A message pasted an hour after it arrived is
        // still "received" now as far as window logic is concerned.
        receivedAt,
        rawMessage: raw,
        source: options.source ?? 'manual_entry',
        adapter: options.adapter ?? 'manual_entry',
        parseStatus: parsed.parseStatus,
        parseError: parsed.error,
        status: 'unmatched',
      })
      .onConflictDoNothing({ target: incomingPayments.trxId })
      .returning()

    if (!row) return null

    await tx
      .update(receivingAccounts)
      .set({ lastCaptureAt: receivedAt })
      .where(eq(receivingAccounts.id, account.id))

    if (parsed.parseStatus === 'failed') {
      await tx.insert(notifierEvents).values({
        receivingAccountId: account.id,
        kind: 'parse_failure',
        severity: 'high',
        detail: parsed.error,
        payload: { incoming_payment_id: row.id, source: options.source ?? 'manual_entry' },
      })
    } else {
      await checkBalanceContinuity(tx, {
        receivingAccountId: account.id,
        reportedBalanceCents: parsed.balanceAfterCents,
        incomingPaymentId: row.id,
        at: receivedAt,
      })
    }

    await audit(tx, {
      action: parsed.parseStatus === 'failed' ? 'payment.parse_failed' : 'payment.captured',
      actorId: options.actorId,
      actorType: 'admin',
      incomingPaymentId: row.id,
      requestId: options.requestId ?? null,
      payload: {
        source: options.source ?? 'manual_entry',
        amount_cents: parsed.amountCents,
        parse_status: parsed.parseStatus,
      },
    })

    return row
  })

  if (!inserted) {
    return {
      status: 'duplicate',
      paymentId: null,
      trxId: parsed.trxId,
      amountCents: parsed.amountCents,
      parseError: null,
      matched: false,
      intentId: null,
    }
  }

  if (parsed.parseStatus === 'failed') {
    return {
      status: 'unparsed',
      paymentId: inserted.id,
      trxId: null,
      amountCents: null,
      parseError: parsed.error,
      matched: false,
      intentId: null,
    }
  }

  let matched = false
  let intentId: string | null = null
  try {
    const outcome = await runMatcher(inserted.id)
    matched = outcome.applied
    intentId = outcome.intentId
  } catch (error) {
    // The row is committed either way. A matcher failure leaves it in the queue.
    logger.error({ err: error, paymentId: inserted.id }, 'matcher failed after manual entry')
  }

  return {
    status: 'accepted',
    paymentId: inserted.id,
    trxId: parsed.trxId,
    amountCents: parsed.amountCents,
    parseError: parsed.error,
    matched,
    intentId,
  }
}
