import { authenticateApp } from '@/lib/api/auth'
import { enforceRateLimit, parseBody, route } from '@/lib/api/handler'
import { extendIntentSchema } from '@/lib/api/schemas'
import { extendIntent, requireIntent } from '@/lib/services/intents'
import { idFromUrl } from '../route'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /v1/intents/:id/extend
 *
 * Holds an order while a buyer tops up an underpayment. Fails with `lock_taken`
 * if another intent has since claimed that amount on that account.
 */
export const POST = route(async (request, context) => {
  const app = await authenticateApp(request)
  enforceRateLimit(context, 'intents:mutate', app.rateKey)

  const intent = await requireIntent(idFromUrl(request.url), app.appId)
  const { ttl_seconds } = await parseBody(request, extendIntentSchema)

  const view = await extendIntent({
    intentId: intent.id,
    appId: app.appId,
    ttlSeconds: ttl_seconds,
    requestId: context.requestId,
  })

  return { status: 200, body: { ...view, request_id: context.requestId } }
})
