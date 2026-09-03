'use server'

import { newRequestId } from '@jomma/shared'
import { and, eq, isNull } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { requireAdmin } from '@/lib/auth/session'
import { db } from '@/lib/db/client'
import { orderPayments } from '@/lib/db/schema'
import { logger } from '@/lib/logger'
import { reversePayment } from '@/lib/services/apply'
import { getIntentDetail } from '@/lib/services/intent-admin'

export async function loadIntentDetail(intentId: string) {
  await requireAdmin()
  return getIntentDetail(intentId)
}

/**
 * Undoing an approved match.
 *
 * `payment.reversed` means Jomma previously said money arrived and is now
 * retracting it — docs/api.md calls it rare and serious, and it is the one
 * event every client has to handle by un-fulfilling an order. Nothing is
 * deleted: the application row is marked reversed and the payment returns to
 * unmatched so it can be re-matched or refunded.
 */
export async function reverseMatchAction(
  intentId: string,
  reason: string,
): Promise<{ ok: boolean; message: string }> {
  const admin = await requireAdmin()
  const requestId = newRequestId()

  try {
    const live = await db
      .select({ id: orderPayments.id })
      .from(orderPayments)
      .where(and(eq(orderPayments.intentId, intentId), isNull(orderPayments.reversedAt)))

    if (live.length === 0) return { ok: false, message: 'Nothing on this intent to reverse.' }

    for (const application of live) {
      await db.transaction((tx) =>
        reversePayment(tx, {
          orderPaymentId: application.id,
          actorId: admin.id,
          reason,
          requestId,
        }),
      )
    }

    revalidatePath('/intents')
    revalidatePath('/queue')
    revalidatePath('/')

    logger.warn({ intentId, admin: admin.id, requestId, count: live.length }, 'match reversed')
    return {
      ok: true,
      message: `Reversed ${live.length} payment${live.length === 1 ? '' : 's'}. A payment.reversed webhook is queued.`,
    }
  } catch (error) {
    logger.error({ err: error, intentId, requestId }, 'reversal failed')
    return { ok: false, message: error instanceof Error ? error.message : 'Could not reverse.' }
  }
}
