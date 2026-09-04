import { fromPublicId, PROVIDERS } from '@jomma/shared'
import { z } from 'zod'
import { ApiError } from '@/lib/api/errors'
import { enforceRateLimit, parseBody, route } from '@/lib/api/handler'
import { intentIdFromPayUrl } from '@/lib/api/pay-url'
import { listCheckoutMethods, switchCheckoutMethod } from '@/lib/services/checkout'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const bodySchema = z.object({ provider: z.enum(PROVIDERS) })

/**
 * POST /api/pay/:id/method — the buyer choosing how to pay.
 *
 * A re-route, not a preference: the receiving account was allocated when the
 * store created the intent, because the amount lock and the reference code both
 * hang off it. `switchCheckoutMethod` refuses when the store named a provider,
 * when anything has already been received, or when the target provider has no
 * routable account — see the rules there.
 *
 * Public for the same reason the rest of these are: the buyer holds a link. The
 * worst a stranger with that link can do is move an unpaid intent between the
 * merchant's own accounts, which changes nothing about who gets the money.
 */
export const POST = route(async (request, context) => {
  const publicId = intentIdFromPayUrl(request.url)
  const uuid = fromPublicId('intent', publicId)
  if (!uuid) throw ApiError.notFound('No such payment.')

  enforceRateLimit(context, 'pay:write', context.ip ?? 'unknown')

  const body = await parseBody(request, bodySchema)
  const { changed } = await switchCheckoutMethod({
    intentId: uuid,
    provider: body.provider,
    requestId: context.requestId,
  })

  // The new list, so the page does not have to re-fetch to redraw the choice.
  const methods = await listCheckoutMethods(uuid)

  return {
    status: 200,
    body: { changed, methods, request_id: context.requestId },
    headers: { 'cache-control': 'no-store' },
  }
})
