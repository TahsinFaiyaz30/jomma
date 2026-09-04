import { NextResponse } from 'next/server'
import { ApiError } from '@/lib/api/errors'
import { enforceRateLimit, route } from '@/lib/api/handler'
import { getPayView } from '@/lib/services/pay-page'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/pay/:id/status — the hosted pay page polling itself.
 *
 * Public on purpose. The buyer is an anonymous visitor holding a link, and
 * putting an API key in their browser to let them watch their own payment would
 * be a far worse trade than making this readable to anyone who has the id.
 *
 * The id is a uuidv7 rendered as 26 base32 characters, so it is not guessable,
 * and `getPayView` returns only what a buyer needs. There is nothing here worth
 * enumerating for: no order id, no account id, no other payments, no totals.
 *
 * Rate limited by IP anyway — a page that polls every two seconds is a nice
 * amplifier if someone points a loop at it.
 */
export const GET = route(async (request, context) => {
  enforceRateLimit(context, 'intents:get', context.ip ?? 'unknown')

  // `route` owns the handler signature so it can guarantee a request id on every
  // path, so the dynamic segment is read off the URL rather than taken as an
  // argument. Same pattern as /v1/intents/:id.
  const segments = new URL(request.url).pathname.split('/').filter(Boolean)
  const id = segments[segments.indexOf('pay') + 1] ?? ''

  const view = await getPayView(id)
  // Same answer for a malformed id and an id that does not exist. Distinguishing
  // them only tells someone probing which half of their guess was right.
  if (!view) throw ApiError.notFound('No such payment.')

  return {
    status: 200,
    body: {
      id: view.id,
      status: view.status,
      amount: view.amountCents,
      received_amount: view.receivedAmountCents,
      shortfall: view.shortfallCents,
      excess: view.excessCents,
      // Included so a split payment landing mid-poll updates the list the buyer
      // is looking at, rather than only moving the outstanding total.
      payments: view.payments.map((payment) => ({
        trx_id: payment.trxId,
        amount: payment.amountCents,
        applied_at: payment.appliedAt,
      })),
      receiving_msisdn: view.receivingMsisdn,
      provider: view.provider,
      ref_code: view.refCode,
      expires_at: view.expiresAt,
      return_url: view.returnUrl,
      request_id: context.requestId,
    },
    headers: { 'cache-control': 'no-store' },
  }
})

export function OPTIONS() {
  return NextResponse.json(null, { status: 204 })
}
