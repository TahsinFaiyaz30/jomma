import { fromPublicId } from '@jomma/shared'
import { and, eq, isNull } from 'drizzle-orm'
import { z } from 'zod'
import { ApiError } from '@/lib/api/errors'
import { enforceRateLimit, parseBody, route } from '@/lib/api/handler'
import { msisdnSchema } from '@/lib/api/schemas'
import { db } from '@/lib/db/client'
import { paymentIntents } from '@/lib/db/schema'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const bodySchema = z.object({ msisdn: msisdnSchema })

/**
 * POST /api/pay/:id/payer — the buyer telling us which number they will pay from.
 *
 * Worth collecting for more than the guide's header. `payer_msisdn` is a signal
 * in the scorer (60 points), so a buyer who names their number up front is much
 * more likely to be matched automatically when the message arrives — and a
 * mismatch between it and the sender is what turns a suspicious payment into a
 * queue item instead of an approval.
 *
 * **Write-once, and only while the intent is open.** The buyer holds a link, not
 * a credential, so this has to be safe against whoever else ends up with that
 * link: setting a wrong number could push a legitimate payment into the manual
 * queue as a sender mismatch. Conditioning the update on the column still being
 * null means the worst anyone can do is win a race with the actual buyer, and
 * that is bounded — the amount and reference still gate everything, and a queued
 * payment is reviewed rather than lost.
 *
 * The store can always set it authoritatively at intent creation, which takes
 * this path out of the picture entirely.
 */
export const POST = route(async (request, context) => {
  enforceRateLimit(context, 'submissions:create', context.ip ?? 'unknown')

  const segments = new URL(request.url).pathname.split('/').filter(Boolean)
  const publicId = segments[segments.indexOf('pay') + 1] ?? ''
  const uuid = fromPublicId('intent', publicId)
  if (!uuid) throw ApiError.notFound('No such payment.')

  const body = await parseBody(request, bodySchema)

  const updated = await db
    .update(paymentIntents)
    .set({ payerMsisdn: body.msisdn })
    .where(
      and(
        eq(paymentIntents.id, uuid),
        eq(paymentIntents.status, 'open'),
        isNull(paymentIntents.payerMsisdn),
      ),
    )
    .returning({ id: paymentIntents.id })

  /*
   * No-op rather than an error when it was already set or the intent has moved
   * on. The buyer cannot act on "somebody already answered this", and failing
   * their page for it would be worse than quietly carrying on.
   */
  return {
    status: 200,
    body: { ok: true, stored: updated.length > 0, request_id: context.requestId },
  }
})
