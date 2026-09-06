'use server'

import { newRequestId } from '@jomma/shared'
import { revalidatePath } from 'next/cache'
import { requireWriteAccess } from '@/lib/auth/tenancy'
import { logger } from '@/lib/logger'
import { assertOwnsIncomingPayment, assertOwnsIntent } from '@/lib/services/businesses'
import { approveFromQueue, rejectFromQueue, restoreToQueue } from '@/lib/services/queue'

/**
 * Queue mutations.
 *
 * Every one calls `requireAdmin` first — a server action is a public HTTP
 * endpoint, and the page having already checked a session says nothing about
 * who is POSTing to the action.
 */

export interface ActionResult {
  ok: boolean
  message: string
}

export async function approveAction(paymentId: string, intentId: string): Promise<ActionResult> {
  const { user: admin, business } = await requireWriteAccess()
  const requestId = newRequestId()

  try {
    // Both sides, because this is the action that moves money between them.
    await assertOwnsIncomingPayment(business.id, paymentId)
    await assertOwnsIntent(business.id, intentId)
    const result = await approveFromQueue({ paymentId, intentId, actorId: admin.id, requestId })
    revalidatePath('/queue')
    revalidatePath('/')

    const outcome =
      result.intentStatus === 'partial'
        ? `applied — still short by ${result.shortfallCents} poisha`
        : result.intentStatus === 'over'
          ? `applied — ${result.excessCents} poisha over`
          : 'applied'

    logger.info({ paymentId, intentId, admin: admin.id, requestId }, 'queue approval')
    return { ok: true, message: `Payment ${outcome}.` }
  } catch (error) {
    logger.error({ err: error, paymentId, intentId, requestId }, 'queue approval failed')
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'Could not apply that payment.',
    }
  }
}

export async function rejectAction(paymentId: string, note?: string): Promise<ActionResult> {
  const { user: admin, business } = await requireWriteAccess()
  const requestId = newRequestId()

  try {
    await assertOwnsIncomingPayment(business.id, paymentId)
    await rejectFromQueue({ paymentId, actorId: admin.id, note, requestId })
    revalidatePath('/queue')
    revalidatePath('/reconcile')
    // Not deleted — orphaned, and still visible on Reconcile as money nothing
    // claims. Say so, so nobody thinks it went away.
    return { ok: true, message: 'Moved to unmatched money on Reconcile.' }
  } catch (error) {
    logger.error({ err: error, paymentId, requestId }, 'queue rejection failed')
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'Could not reject that payment.',
    }
  }
}

export async function restoreAction(paymentId: string): Promise<ActionResult> {
  const { user: admin, business } = await requireWriteAccess()

  try {
    await assertOwnsIncomingPayment(business.id, paymentId)
    await restoreToQueue({ paymentId, actorId: admin.id })
    revalidatePath('/queue')
    return { ok: true, message: 'Back in the queue.' }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'Could not restore that payment.',
    }
  }
}
