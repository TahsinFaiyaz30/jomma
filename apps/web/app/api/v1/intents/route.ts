import { authenticateApp } from '@/lib/api/auth'
import { enforceRateLimit, parseBody, route } from '@/lib/api/handler'
import { createIntentSchema } from '@/lib/api/schemas'
import { createIntent } from '@/lib/services/intents'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /v1/intents — create a payment request.
 *
 * Allocates a reference code and an exclusive lock on (account, amount), then
 * returns everything the buyer needs to see: the number, the exact amount, and
 * the code.
 */
export const POST = route(async (request, context) => {
  const app = await authenticateApp(request)
  enforceRateLimit(context, 'intents:create', app.rateKey)

  const input = await parseBody(request, createIntentSchema)
  const idempotencyKey = request.headers.get('idempotency-key')?.trim() || null

  const { intent, replayed } = await createIntent({
    appId: app.appId,
    input,
    idempotencyKey,
    requestId: context.requestId,
  })

  return {
    // A replay is not a creation. 200 tells a careful client it got the
    // original back rather than a second code.
    status: replayed ? 200 : 201,
    body: { ...intent, request_id: context.requestId },
    headers: (replayed ? { 'idempotent-replay': 'true' } : {}) as Record<string, string>,
  }
})
