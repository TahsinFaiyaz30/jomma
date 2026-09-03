import { authenticateApp } from '@/lib/api/auth'
import { enforceRateLimit, route } from '@/lib/api/handler'
import { cancelIntent, requireIntent } from '@/lib/services/intents'
import { idFromUrl } from '../route'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /v1/intents/:id/cancel
 *
 * Releases the lock and expires the reference code immediately. Safe to call on
 * an already-cancelled intent — cancellation is idempotent by design, because a
 * client retrying a cancel after a timeout must not get an error.
 */
export const POST = route(async (request, context) => {
  const app = await authenticateApp(request)
  enforceRateLimit(context, 'intents:mutate', app.rateKey)

  const intent = await requireIntent(idFromUrl(request.url), app.appId)

  const view = await cancelIntent({
    intentId: intent.id,
    appId: app.appId,
    requestId: context.requestId,
  })

  return { status: 200, body: { ...view, request_id: context.requestId } }
})
