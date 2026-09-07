import { type NextRequest, NextResponse } from 'next/server'

/**
 * Content-Security-Policy, with a per-request nonce.
 *
 * The static headers in `next.config.ts` cover framing, sniffing and referrers.
 * They do nothing about injected script, which on this product is the attack
 * worth caring about: the dashboard renders `raw_message` — text that arrived
 * from a stranger's SMS, by way of a phone nobody at Jomma controls — next to a
 * signed-in session that can approve payments and mint API keys.
 *
 * React escapes all of it, and the one `dangerouslySetInnerHTML` in the tree was
 * an unused chart component that has been deleted. This is the layer underneath
 * that: if either of those facts stops being true, a CSP is what decides whether
 * the bug is a rendering glitch or a stolen session.
 *
 * ## Why a nonce rather than 'unsafe-inline'
 *
 * Next streams its RSC payload through inline `<script>` tags, so a policy that
 * simply forbids inline script would blank every page. The usual workaround is
 * `'unsafe-inline'`, which switches off precisely the protection the header is
 * for. Next reads the nonce out of this header and stamps it onto its own
 * scripts instead, so inline stays allowed for the framework and forbidden for
 * anything an attacker manages to inject.
 *
 * `'strict-dynamic'` is deliberately absent: it is what lets a nonced loader
 * pull in further scripts, and nothing here needs to.
 *
 * ## The directives that matter even without script-src
 *
 * `object-src`, `base-uri` and `form-action` block the escalation paths that
 * survive an otherwise strict policy — a `<base>` tag rewriting every relative
 * URL on the page, or a form re-pointed at somebody else's collector. They cost
 * nothing and are worth having regardless.
 *
 * `frame-ancestors` says the same thing as `X-Frame-Options: DENY`, kept
 * alongside it because the older header is ignored by newer browsers when a CSP
 * is present and still honoured by older ones.
 *
 * ## Development
 *
 * `'unsafe-eval'` is added outside production only. Turbopack's HMR runtime
 * needs it, and shipping it would undo much of the rest.
 */
export default function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64')
  const isProduction = process.env.NODE_ENV === 'production'

  const policy = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'${isProduction ? '' : " 'unsafe-eval'"}`,
    // Styles stay inline-permitted: Tailwind emits a stylesheet, but Next and
    // the chart-free UI still set style attributes, and a nonce does not apply
    // to those. The exposure from injected CSS is defacement, not code.
    "style-src 'self' 'unsafe-inline'",
    // `data:` for the provisioning QR, which is handed to the page as a data
    // URL rather than a fetch, and `blob:` for the downloadable copy of it.
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    // The dashboard polls its own origin and nothing else. No analytics, no
    // crash reporter, no CDN — see AGENTS.md on what this service talks to.
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "manifest-src 'self'",
    // Harmless on http, and the one directive that makes a mixed-content
    // mistake on a self-hosted instance fail loudly instead of silently.
    ...(isProduction ? ['upgrade-insecure-requests'] : []),
  ].join('; ')

  const headers = new Headers(request.headers)
  headers.set('x-nonce', nonce)
  /*
   * The same policy on the *request*, which is the half that actually works.
   *
   * Next reads the nonce back out of this header and stamps it onto the inline
   * scripts it emits for the RSC payload. Setting it only on the response looks
   * right, sends a correct-looking header, and blocks Next's own bootstrap —
   * the page still paints from the server-rendered HTML, so the damage shows up
   * as interactivity quietly not working rather than as a blank screen.
   */
  headers.set('Content-Security-Policy', policy)

  const response = NextResponse.next({ request: { headers } })
  response.headers.set('Content-Security-Policy', policy)

  return response
}

export const config = {
  matcher: [
    /*
     * Everything except Next's own static output and the favicon.
     *
     * Those are immutable files served straight from disk; running this
     * for each one buys nothing and costs a function invocation per asset. The
     * negative lookahead is the pattern Next documents for exactly this.
     */
    {
      source: '/((?!_next/static|_next/image|favicon.ico).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
}
