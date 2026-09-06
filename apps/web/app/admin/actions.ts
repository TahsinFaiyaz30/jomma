'use server'

import { BUSINESS_STATUSES, type BusinessStatus } from '@jomma/shared'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { multilineText } from '@/lib/api/schemas'
import { requirePlatformAdmin } from '@/lib/auth/session'
import { reviewBusiness } from '@/lib/services/businesses'

export interface ReviewResult {
  ok: boolean
  message: string
}

/**
 * The last of the free-text fields going to Postgres unchecked.
 *
 * Lower stakes than the others -- only a platform admin reaches this -- but the
 * same NUL that `text` cannot hold, and the same 500 when it arrives. The
 * argument types are erased at runtime, so `status` is worth confirming here
 * too rather than trusted because TypeScript said so.
 *
 * Multi-line, like the refund note: "rejected because the number you gave
 * belongs to another merchant" is read by the merchant, and whoever writes it
 * may well use the return key.
 */
const reviewSchema = z.object({
  status: z.enum(BUSINESS_STATUSES).exclude(['pending']),
  reason: multilineText(1000).optional(),
})

/**
 * Approving, rejecting or suspending a merchant.
 *
 * Guarded by `requirePlatformAdmin`, which is authority over the *instance* and
 * deliberately unrelated to membership of any business. Someone running the
 * deployment can decide who trades on it without thereby being able to read
 * anyone's takings.
 */
export async function reviewBusinessAction(
  businessId: string,
  status: Exclude<BusinessStatus, 'pending'>,
  reason?: string,
): Promise<ReviewResult> {
  const admin = await requirePlatformAdmin()

  const parsed = reviewSchema.safeParse({ status, reason })
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Check the reason and retry.' }
  }

  try {
    await reviewBusiness({ ...parsed.data, businessId, reviewedBy: admin.id })
    revalidatePath('/admin')

    return {
      ok: true,
      message:
        status === 'active'
          ? 'Approved. They can take payments now.'
          : status === 'rejected'
            ? 'Declined. They can see the reason.'
            : 'Suspended. Payments stop immediately.',
    }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'Could not update the business.',
    }
  }
}
