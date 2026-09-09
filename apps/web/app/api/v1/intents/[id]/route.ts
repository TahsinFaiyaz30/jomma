import { authenticateApp } from '@/lib/api/auth'
import { ApiError } from '@/lib/api/errors'
import { enforceRateLimit, route } from '@/lib/api/handler'
import { expireIntentIfDue, getIntentView, requireIntent } from '@/lib/services/intents'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /v1/intents/:id — polled from the pay page every 2–3 seconds, hence the
 * generous 600/min limit.
 *
 * The expiry check is not decoration. This endpoint used to return the stored
 * `status` column untouched, so an intent well past its own `expires_at`
 * answered `open` until something swept it — and if no worker or cron was
 * running, that was forever. A shop reported exactly that: two intents more
 * than a day overdue, still `open`, with stock reserved against orders that
 * could never be paid. The hosted pay page had always derived expiry from the
 * deadline, so the buyer's screen and the merchant's API disagreed about
 * whether the same payment was alive.
 *
 * Doing it here rather than inside `getIntentView` keeps the write on the
 * authenticated, rate-limited path and out of the several other callers that
 * only want to render. It is conditional and idempotent, so the polling in the
 * doc comment above costs one no-op update per expired intent, once.
 */
export const GET = route(async (request, context) => {
  const app = await authenticateApp(request, context)
  enforceRateLimit(context, 'intents:get', app.rateKey)

  const publicId = idFromUrl(request.url)
  const intent = await requireIntent(publicId, app.appId)

  await expireIntentIfDue(intent.id)

  const view = await getIntentView(intent.id)
  if (!view) throw ApiError.notFound()

  return { status: 200, body: { ...view, request_id: context.requestId } }
})

/**
 * Next hands dynamic segments to the handler as a second argument, but `route`
 * owns that signature so it can guarantee a request id on every path. Reading
 * the segment off the URL keeps one wrapper for every route.
 */
export function idFromUrl(url: string): string {
  const segments = new URL(url).pathname.split('/').filter(Boolean)
  const index = segments.indexOf('intents')
  return index >= 0 ? (segments[index + 1] ?? '') : ''
}
