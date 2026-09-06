'use server'

import { requireAdmin } from '@/lib/auth/session'
import { setActiveBusiness } from '@/lib/auth/tenancy'

/**
 * Changing which business the dashboard is showing.
 *
 * The id arrives from the client, so it is a claim rather than a fact —
 * `setActiveBusiness` refuses one the signed-in user has no membership for.
 * Without that check this action would be a way to read any business on the
 * instance by guessing a uuid, and uuidv7 sorts by creation time, so a
 * neighbour's is guessable from your own.
 */
export async function switchBusinessAction(
  businessId: string,
): Promise<{ ok: boolean; message: string }> {
  const user = await requireAdmin()

  const switched = await setActiveBusiness(user.id, businessId)
  if (!switched) return { ok: false, message: 'You do not have access to that business.' }

  return { ok: true, message: 'Switched.' }
}
