import type { Provider } from '@jomma/shared'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { incomingPayments, notifierEvents, receivingAccounts } from '@/lib/db/schema'
import { logger, redactMsisdn } from '@/lib/logger'
import { parseMessage } from '@/lib/parsers'
import { audit } from './audit'
import { checkBalanceContinuity } from './balance'
import { runMatcher } from './match-runner'

/**
 * Capture ingestion.
 *
 * The ordering in docs/api.md, and why each step is where it is:
 *
 *   1. Store `raw` before anything parses it.
 *   2. Parse. On failure, store with `parse_status: 'failed'` and alert. Never
 *      drop.
 *   3. Dedupe on `trx_id`. A duplicate is a `duplicate`, not an error.
 *   4. Balance continuity check.
 *   5. Enqueue matching.
 *
 * Steps 1 and 2 are collapsed into a single INSERT that always carries the raw
 * text. That is not a shortcut around the rule: `parseMessage` is total — it
 * catches its own throws and returns a `failed` result — so there is no code
 * path where a parser fault can prevent the row being written. Splitting them
 * into insert-then-update would instead break step 3, because the unique index
 * on `trx_id` cannot deduplicate a row that does not have one yet.
 */

export type CaptureStatus = 'accepted' | 'duplicate' | 'unparsed'

export interface CaptureInput {
  localId: string
  source: 'notification' | 'sms'
  packageName: string | null
  raw: string
  capturedAt: Date | null
}

export interface CaptureOutcome {
  local_id: string
  status: CaptureStatus
  trx_id: string | null
}

export async function ingestCaptures(options: {
  deviceId: string
  receivingAccountId: string
  provider: Provider
  captures: CaptureInput[]
  requestId: string
}): Promise<CaptureOutcome[]> {
  const results: CaptureOutcome[] = []
  const matchable: string[] = []

  for (const capture of options.captures) {
    const parsed = parseMessage(options.provider, capture.raw, capture.packageName)
    const receivedAt = new Date()

    const inserted = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(incomingPayments)
        .values({
          receivingAccountId: options.receivingAccountId,
          deviceId: options.deviceId,
          provider: options.provider,
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
          capturedAt: capture.capturedAt,
          receivedAt,
          rawMessage: capture.raw,
          packageName: capture.packageName,
          localId: capture.localId,
          source: capture.source,
          adapter: capture.source === 'sms' ? 'android_sms' : 'android_notification',
          parseStatus: parsed.parseStatus,
          parseError: parsed.error,
          status: 'unmatched',
        })
        // Dual capture is deliberate — the notification and the SMS arrive
        // independently so that either path failing still delivers the payment.
        // This constraint is what makes that safe.
        .onConflictDoNothing({ target: incomingPayments.trxId })
        .returning()

      if (!row) return null

      await tx
        .update(receivingAccounts)
        .set({ lastCaptureAt: receivedAt })
        .where(eq(receivingAccounts.id, options.receivingAccountId))

      if (parsed.parseStatus === 'failed') {
        // Never drop. The raw text is committed above; this is the alert that
        // gets a human to look at it.
        await tx.insert(notifierEvents).values({
          receivingAccountId: options.receivingAccountId,
          deviceId: options.deviceId,
          kind: 'parse_failure',
          severity: 'high',
          detail: parsed.error,
          payload: {
            incoming_payment_id: row.id,
            source: capture.source,
            package: capture.packageName,
            // Length only. The message itself is PII and lives in the row.
            raw_length: capture.raw.length,
          },
        })

        await audit(tx, {
          action: 'payment.parse_failed',
          actorType: 'device',
          incomingPaymentId: row.id,
          requestId: options.requestId,
          payload: { error: parsed.error, source: capture.source },
        })

        return row
      }

      await checkBalanceContinuity(tx, {
        receivingAccountId: options.receivingAccountId,
        reportedBalanceCents: parsed.balanceAfterCents,
        incomingPaymentId: row.id,
        at: receivedAt,
      })

      await audit(tx, {
        action: 'payment.captured',
        actorType: 'device',
        incomingPaymentId: row.id,
        requestId: options.requestId,
        payload: {
          source: capture.source,
          amount_cents: parsed.amountCents,
          transaction_type: parsed.transactionType,
          parse_status: parsed.parseStatus,
          sender: redactMsisdn(parsed.senderMsisdn),
        },
      })

      return row
    })

    if (!inserted) {
      results.push({
        local_id: capture.localId,
        status: 'duplicate',
        trx_id: parsed.trxId,
      })
      continue
    }

    if (parsed.parseStatus === 'failed') {
      results.push({
        local_id: capture.localId,
        status: 'unparsed',
        trx_id: null,
      })
      continue
    }

    results.push({
      local_id: capture.localId,
      status: 'accepted',
      trx_id: parsed.trxId,
    })
    matchable.push(inserted.id)
  }

  /*
   * Matching runs after the captures are committed, so the device gets its ack
   * without waiting on the scorer. A failure here leaves the payment
   * `unmatched`, which the orphan retry loop and the manual queue both pick up —
   * it can never lose the money.
   */
  for (const paymentId of matchable) {
    try {
      await runMatcher(paymentId)
    } catch (error) {
      logger.error({ err: error, paymentId }, 'matcher failed after capture')
    }
  }

  return results
}
