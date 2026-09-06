'use server'

import type { BusinessStatus } from '@jomma/shared'
import { revalidatePath } from 'next/cache'
import { requirePlatformAdmin } from '@/lib/auth/session'
import { reviewBusiness } from '@/lib/services/businesses'

export interface ReviewResult {
  ok: boolean
  message: string
}

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

  try {
    await reviewBusiness({ businessId, status, reason, reviewedBy: admin.id })
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
