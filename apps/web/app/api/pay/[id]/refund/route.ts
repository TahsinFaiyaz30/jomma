import { fromPublicId, REFUND_REASONS } from '@jomma/shared'
import { z } from 'zod'
import { ApiError } from '@/lib/api/errors'
import { enforceRateLimit, parseBody, route } from '@/lib/api/handler'
import { intentIdFromPayUrl } from '@/lib/api/pay-url'
import { msisdnSchema } from '@/lib/api/schemas'
import { requestRefund } from '@/lib/services/refunds'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const bodySchema = z.object({
  reason: z.enum(REFUND_REASONS),
  note: z.string().trim().max(500).optional().nullable(),
  contact_msisdn: msisdnSchema.optional().nullable(),
})

/**
 * POST /api/pay/:id/refund — the buyer asking the store for money back.
 *
 * Needed most for the case that is now automatic: an over-payment completes the
 * order on its own, so without this the excess is a debt nobody is chasing. The
 * buyer can also ask to cancel, which Jomma equally cannot do — the order lives
 * in the store's system.
 *
 * So this records the ask and fires `payment.refund_requested` on the app's
 * signed webhook. **It moves no money.** Jomma watches a merchant's accounts
 * and has no authority over them; anything else would be pretending otherwise.
 *
 * Public, like the rest of the pay endpoints: the buyer holds a link. The worst
 * a stranger with it can do is raise a support ticket the merchant then reads.
 */
export const POST = route(async (request, context) => {
  const publicId = intentIdFromPayUrl(request.url)
  const uuid = fromPublicId('intent', publicId)
  if (!uuid) throw ApiError.notFound('No such payment.')

  enforceRateLimit(context, 'pay:refund', context.ip ?? 'unknown')
  enforceRateLimit(context, 'pay:refund', `refund:${uuid}`)

  const body = await parseBody(request, bodySchema)

  const result = await requestRefund({
    intentId: uuid,
    reason: body.reason,
    note: body.note ?? null,
    contactMsisdn: body.contact_msisdn ?? null,
    requestId: context.requestId,
  })

  return {
    status: 200,
    body: { ...result, request_id: context.requestId },
    headers: { 'cache-control': 'no-store' },
  }
})
