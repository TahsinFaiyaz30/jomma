import { fromPublicId } from '@jomma/shared'
import { NextResponse } from 'next/server'
import { ApiError } from '@/lib/api/errors'
import { enforceRateLimit, route } from '@/lib/api/handler'
import { handoffIsLive } from '@/lib/services/handoff'
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
  const url = new URL(request.url)
  const segments = url.pathname.split('/').filter(Boolean)
  const id = segments[segments.indexOf('pay') + 1] ?? ''

  const view = await getPayView(id)
  // Same answer for a malformed id and an id that does not exist. Distinguishing
  // them only tells someone probing which half of their guess was right.
  if (!view) throw ApiError.notFound('No such payment.')

  /*
   * How a scanned phone finds out it has been let go of.
   *
   * The buyer can go back on the screen that produced the QR and pick a
   * different wallet, which moves the intent to a different receiving account.
   * The phone is already polling; without this it would quietly swap in the new
   * number and carry on, which is the one outcome worse than stopping — a page
   * that changes where to send money under somebody halfway through sending it.
   *
   * Only computed when a token is presented, so the ordinary page pays nothing
   * for it.
   */
  const handoff = url.searchParams.get('h') ?? ''
  const uuid = handoff.length > 0 ? fromPublicId('intent', view.id) : null
  const handoffValid = uuid ? await handoffIsLive(uuid, handoff) : null

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
      /*
       * The two fields that are the instruction to send money, withheld from a
       * merchant the platform has stopped. Everything else stays: the buyer can
       * still watch a payment they already made land, and still ask for it
       * back. See `PayView.acceptingPayments`.
       */
      receiving_msisdn: view.acceptingPayments ? view.receivingMsisdn : null,
      provider: view.provider,
      ref_code: view.acceptingPayments ? view.refCode : null,
      accepting_payments: view.acceptingPayments,
      // Null when the caller presented no token — it is not a claim about this
      // payment, only about the asking page's own session.
      handoff_valid: handoffValid,
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
