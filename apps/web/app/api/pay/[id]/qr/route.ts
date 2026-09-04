import { NextResponse } from 'next/server'
import { clientIp } from '@/lib/api/handler'
import { consume } from '@/lib/api/ratelimit'
import { getPayView } from '@/lib/services/pay-page'
import { renderPayQrPng, requestOrigin } from '@/lib/services/qr'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/pay/:id/qr — the pay page as a scannable image.
 *
 * Public for the same reason the status endpoint is: the buyer is an anonymous
 * visitor holding a link, and this returns a picture of the link they are
 * already holding. It carries nothing the page itself does not.
 *
 * Written by hand rather than through `route()`, which serialises its result as
 * JSON. Everything that wrapper is there for still happens here — a rate limit,
 * the same 404 for a malformed id as for an unknown one — it just ends in a PNG.
 *
 * The intent is looked up rather than assumed, so a guessed id renders nothing.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const ip = clientIp(request) ?? 'unknown'
  const limit = consume('intents:get', ip)

  const headers: Record<string, string> = {
    'x-ratelimit-limit': String(limit.limit),
    'x-ratelimit-remaining': String(limit.remaining),
    'x-ratelimit-reset': String(limit.reset),
  }

  if (!limit.ok) {
    return NextResponse.json(
      { error: { code: 'rate_limited', message: 'Too many requests.' } },
      { status: 429, headers: { ...headers, 'retry-after': String(limit.retryAfter) } },
    )
  }

  const segments = new URL(request.url).pathname.split('/').filter(Boolean)
  const id = segments[segments.indexOf('pay') + 1] ?? ''

  const view = await getPayView(id)
  if (!view) {
    return NextResponse.json(
      { error: { code: 'not_found', message: 'No such payment.' } },
      { status: 404, headers },
    )
  }

  const png = await renderPayQrPng(view.id, requestOrigin(request))

  return new NextResponse(png as unknown as BodyInit, {
    status: 200,
    headers: {
      ...headers,
      'content-type': 'image/png',
      'content-length': String(png.byteLength),
      // The response varies by request host, and it costs one QR encode of a
      // sixty-character string. There is nothing to gain by letting a cache
      // anywhere hold a payment link, so none of them are invited to.
      'cache-control': 'no-store',
      // Belt and braces on a route that returns bytes from a public URL.
      'x-content-type-options': 'nosniff',
      'content-disposition': `inline; filename="jomma-${view.id}.png"`,
    },
  })
}
