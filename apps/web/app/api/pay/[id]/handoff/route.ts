import { fromPublicId } from '@jomma/shared'
import { ApiError } from '@/lib/api/errors'
import { enforceRateLimit, route } from '@/lib/api/handler'
import { intentIdFromPayUrl } from '@/lib/api/pay-url'
import { issueHandoff, revokeHandoff } from '@/lib/services/handoff'
import { isAcceptingPayments } from '@/lib/services/pay-page'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * The pay page handing itself to a second screen, and taking itself back.
 *
 * `POST` when the buyer reaches the instructions: mint the token that the QR
 * will carry, so a phone scanning it lands on the instructions rather than at
 * the top of the queue. `DELETE` when they leave the instructions: clear it, so
 * the QR stops resolving and the phone stops showing a number the buyer may be
 * about to change. See `lib/services/handoff.ts` for why the second half is the
 * one that matters.
 *
 * Public like the rest of these, because the buyer holds a link rather than a
 * credential. Nothing here reveals anything: the token is minted server-side
 * for an intent the caller already named, and the worst a stranger with the
 * link can do is invalidate a QR that only the buyer is looking at.
 */
function intentUuid(url: string): string {
  const uuid = fromPublicId('intent', intentIdFromPayUrl(url))
  if (!uuid) throw ApiError.notFound('No such payment.')
  return uuid
}

export const POST = route(async (request, context) => {
  const uuid = intentUuid(request.url)
  enforceRateLimit(context, 'pay:write', context.ip ?? 'unknown')

  /*
   * A suspended merchant may not be helped to take another payment, and this
   * endpoint answers anyone holding the link directly. The pay page already
   * withholds the number in that state; a QR carrying somebody to the same page
   * would be a second route to the same instruction, which is exactly what the
   * QR route refuses for.
   */
  if (!(await isAcceptingPayments(uuid))) {
    throw ApiError.forbidden('This shop cannot take payments at the moment.')
  }

  const token = await issueHandoff(uuid)
  if (!token) throw ApiError.notFound('No such payment.')

  return {
    status: 200,
    body: { token, request_id: context.requestId },
    headers: { 'cache-control': 'no-store' },
  }
})

/**
 * Always 200, even when there was nothing to revoke.
 *
 * This is called on the way out of a screen, and the caller's next act is to
 * show the buyer a different one. Failing it would leave somebody stuck on the
 * instructions because a token they never knew existed was already gone.
 */
export const DELETE = route(async (request, context) => {
  const uuid = intentUuid(request.url)
  enforceRateLimit(context, 'pay:write', context.ip ?? 'unknown')

  await revokeHandoff(uuid)

  return {
    status: 200,
    body: { ok: true, request_id: context.requestId },
    headers: { 'cache-control': 'no-store' },
  }
})
