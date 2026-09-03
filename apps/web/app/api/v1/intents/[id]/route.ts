import { authenticateApp } from '@/lib/api/auth'
import { ApiError } from '@/lib/api/errors'
import { enforceRateLimit, route } from '@/lib/api/handler'
import { getIntentView, requireIntent } from '@/lib/services/intents'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /v1/intents/:id — polled from the pay page every 2–3 seconds, hence the
 * generous 600/min limit.
 */
export const GET = route(async (request, context) => {
  const app = await authenticateApp(request)
  enforceRateLimit(context, 'intents:get', app.rateKey)

  const publicId = idFromUrl(request.url)
  const intent = await requireIntent(publicId, app.appId)

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
