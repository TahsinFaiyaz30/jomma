import { authenticateApp } from '@/lib/api/auth'
import { enforceRateLimit, parseBody, route } from '@/lib/api/handler'
import { createSubmissionSchema } from '@/lib/api/schemas'
import { requireIntent } from '@/lib/services/intents'
import { resolveSubmission } from '@/lib/services/submissions'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /v1/submissions — the manual path.
 *
 * Resolves synchronously against observed payments and returns one of nine
 * resolutions plus the numbers behind it. The client renders the message; Jomma
 * supplies the figures.
 */
export const POST = route(async (request, context) => {
  const app = await authenticateApp(request)
  enforceRateLimit(context, 'submissions:create', app.rateKey)

  const input = await parseBody(request, createSubmissionSchema)
  const intent = await requireIntent(input.intent_id, app.appId)

  const result = await resolveSubmission({
    intentId: intent.id,
    appId: app.appId,
    trxId: input.trx_id,
    senderMsisdn: input.sender_msisdn ?? null,
    claimedAmountCents: input.claimed_amount ?? null,
    ip: context.ip,
    requestId: context.requestId,
  })

  return { status: 200, body: { ...result, request_id: context.requestId } }
})
