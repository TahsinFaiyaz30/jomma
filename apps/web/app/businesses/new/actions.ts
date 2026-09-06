'use server'

import { isServiceMode } from '@jomma/shared/env'
import { redirect } from 'next/navigation'
import { requireAdmin } from '@/lib/auth/session'
import { setActiveBusiness } from '@/lib/auth/tenancy'
import { createBusiness } from '@/lib/services/businesses'

export interface NewBusinessResult {
  ok: boolean
  message: string
}

/**
 * Registering a merchant.
 *
 * The signed-in user becomes its owner, and it starts `pending` — they can set
 * everything up and look around, and cannot receive a payment until a platform
 * admin approves it. See BUSINESS_STATUSES.
 */
export async function createBusinessAction(input: {
  name: string
  contactEmail: string
  contactPhone: string
  description: string
}): Promise<NewBusinessResult> {
  const user = await requireAdmin()

  /*
   * Refused outright when this instance belongs to one shop. Self-hosted there
   * is exactly one business, created on first run, and a second would silently
   * split the instance in half — the new one would own no phones and no keys,
   * and its owner would see an empty dashboard with no way to explain it.
   */
  if (!isServiceMode()) {
    return { ok: false, message: 'This instance is running as a single business.' }
  }

  try {
    const business = await createBusiness(user.id, {
      name: input.name,
      contactEmail: input.contactEmail,
      contactPhone: input.contactPhone,
      description: input.description,
    })

    // Make it the one they are looking at, or they land back on a chooser
    // having just made the only choice available.
    await setActiveBusiness(user.id, business.id)
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'Could not create the business.',
    }
  }

  // Outside the try: `redirect` works by throwing, and catching it here would
  // report a successful creation as a failure.
  redirect('/pending')
}
