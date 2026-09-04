import { fromPublicId } from '@jomma/shared'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { ApiError } from '@/lib/api/errors'
import { enforceRateLimit, parseBody, route } from '@/lib/api/handler'
import { intentIdFromPayUrl } from '@/lib/api/pay-url'
import { trxIdSchema } from '@/lib/api/schemas'
import { db } from '@/lib/db/client'
import { paymentIntents } from '@/lib/db/schema'
import { resolveSubmission } from '@/lib/services/submissions'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/*
 * Deliberately only the TrxID.
 *
 * `resolveSubmission` falls back to a submitted sender when the intent has no
 * declared payer — which is fine for a store submitting on a buyer's behalf,
 * and self-certifying nonsense coming from the buyer. They would be supplying
 * both the claim and the evidence for it. The hosted page requires the payer
 * number before it shows instructions, so the intent always has an
 * authoritative one by the time anybody gets here.
 */
const bodySchema = z.object({ trx_id: trxIdSchema })

/**
 * POST /api/pay/:id/submit — the buyer typing in their TrxID.
 *
 * The fallback for when automatic matching is slow or has not happened: the
 * phone might be off, the message might have arrived in a format the parser
 * could not read, or the buyer might simply be impatient. Either way the money
 * is real and the buyer can prove it with a number only they could know.
 *
 * This runs the *same* `createSubmission` the authenticated client API runs, so
 * all nine resolutions, the amount arithmetic and the split-payment accounting
 * are identical. There is no second implementation of "is this payment valid".
 *
 * Public, because the buyer is an anonymous visitor holding a link. That is
 * safe for a specific reason: submitting a TrxID cannot *create* money. The
 * TrxID has to already exist in `incoming_payments`, on this intent's receiving
 * account, unspent — all of which comes from a message the phone captured. A
 * guessed TrxID resolves to `not_found`, and a real one belonging to another
 * intent resolves to `already_used`.
 *
 * What it could be abused for is guessing, so it is rate limited per intent as
 * well as per IP, and every attempt is recorded as a submission row whether it
 * resolved or not.
 */
export const POST = route(async (request, context) => {
  const publicId = intentIdFromPayUrl(request.url)
  const uuid = fromPublicId('intent', publicId)
  if (!uuid) throw ApiError.notFound('No such payment.')

  // Two buckets. The per-IP one stops a script walking the TrxID space; the
  // per-intent one stops a single link being hammered from many addresses.
  enforceRateLimit(context, 'pay:submit', context.ip ?? 'unknown')
  enforceRateLimit(context, 'pay:submit', `intent:${uuid}`)

  const body = await parseBody(request, bodySchema)

  const intent = await db.query.paymentIntents.findFirst({
    columns: { appId: true },
    where: eq(paymentIntents.id, uuid),
  })
  if (!intent) throw ApiError.notFound('No such payment.')

  const result = await resolveSubmission({
    intentId: uuid,
    // The intent's own app. A buyer holds a link, not a key, so there is no
    // app identity on this request to check against — the intent supplies it.
    appId: intent.appId,
    trxId: body.trx_id,
    senderMsisdn: null,
    // Never trusted from a buyer: the amount is read off the captured message,
    // not off what somebody typed.
    claimedAmountCents: null,
    ip: context.ip,
    requestId: context.requestId,
  })

  return {
    status: 200,
    body: { ...result, request_id: context.requestId },
    headers: { 'cache-control': 'no-store' },
  }
})
