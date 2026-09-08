import { fromPublicId } from '@jomma/shared'
import { and, eq } from 'drizzle-orm'
import { ApiError } from '@/lib/api/errors'
import { enforceRateLimit, route } from '@/lib/api/handler'
import { db } from '@/lib/db/client'
import { paymentIntents } from '@/lib/db/schema'
import { isAcceptingPayments } from '@/lib/services/pay-page'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/pay/:id/payer/confirm — the buyer vouching for the store's guess.
 *
 * Separate from the sibling route that takes a number, because this one has
 * none to take. The pay page only ever receives the suggestion masked — it is
 * public to anyone holding the link — so the buyer confirming it cannot echo it
 * back, and asking them to would be handing the number out to prove they
 * already had it.
 *
 * Nothing about the payment changes. `payer_msisdn` keeps the value the store
 * supplied; all that moves is who vouched for it, from 'store' to 'buyer'. That
 * distinction is the entire point: the page confirms a suggestion and trusts an
 * answer, and without recording the answer a reload would ask again.
 *
 * Conditioned on the source still being 'store', so this can only ever promote
 * a suggestion. It cannot overwrite a number the buyer typed, and it cannot
 * invent one where there is none.
 */
export const POST = route(async (request, context) => {
  enforceRateLimit(context, 'pay:write', context.ip ?? 'unknown')

  const segments = new URL(request.url).pathname.split('/').filter(Boolean)
  const publicId = segments[segments.indexOf('pay') + 1] ?? ''
  const uuid = fromPublicId('intent', publicId)
  if (!uuid) throw ApiError.notFound('No such payment.')

  // A suspended merchant may not be helped to take another payment, and this
  // endpoint answers anyone holding the link directly.
  if (!(await isAcceptingPayments(uuid))) {
    throw ApiError.forbidden('This shop cannot take payments at the moment.')
  }

  await db
    .update(paymentIntents)
    .set({ payerMsisdnSource: 'buyer' })
    .where(
      and(
        eq(paymentIntents.id, uuid),
        eq(paymentIntents.status, 'open'),
        eq(paymentIntents.payerMsisdnSource, 'store'),
      ),
    )

  /*
   * Always 200, matching the sibling route. A confirmation that lands twice, or
   * after the intent has closed, is not something the buyer can act on — and
   * failing their page over it would be worse than quietly carrying on.
   */
  return { status: 200, body: { ok: true, request_id: context.requestId } }
})
