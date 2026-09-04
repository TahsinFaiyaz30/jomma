import { authenticateApp } from '@/lib/api/auth'
import { enforceRateLimit, parseBody, route } from '@/lib/api/handler'
import { createIntentSchema } from '@/lib/api/schemas'
import { createIntent } from '@/lib/services/intents'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /v1/intents — create a payment request.
 *
 * Allocates a reference code and returns everything the buyer needs to see: the
 * number, the exact amount, and the code.
 *
 * There is no lock on (account, amount). Any number of buyers can owe the same
 * amount on the same number at once — they are told apart by their reference
 * codes, not by what they owe.
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
