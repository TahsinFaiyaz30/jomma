import 'server-only'

import { env } from '@jomma/shared/env'
import QRCode from 'qrcode'

/**
 * The QR on the pay page.
 *
 * ## What it does not encode, and why
 *
 * The obvious version carries the number, the amount and the reference, so a
 * buyer scans it in bKash and only has to type a PIN. That cannot be built, and
 * the reasons are worth writing down so nobody spends another afternoon on it:
 *
 *  - bKash's scanner reads bKash-issued account QRs. Send Money by QR works by
 *    scanning the *recipient's* customer QR, and the identifier inside it is
 *    minted by bKash against a real wallet — a phone number is not enough to
 *    construct one.
 *  - That QR carries no amount. The app shows the running balance and charge
 *    while the sender types it. It carries no reference either, which is why
 *    every school and shop collecting by bKash tells payers to type an invoice
 *    number into Reference by hand.
 *  - There is no `bkash://` deep link that prefills the fields. That looks
 *    deliberate rather than missing: making the sender type the amount is what
 *    stops a link talking them into sending the wrong one.
 *  - The one format anyone can construct is Bangla QR, the EMVCo
 *    merchant-presented standard. Scanning it starts a Merchant Payment, not a
 *    Send Money — a different transaction, with a different confirmation
 *    message that lib/parsers/bkash.ts does not read. It would need a merchant
 *    account and it would break automatic matching for everyone who has one.
 *
 * ## What it encodes instead
 *
 * This page's own URL. Which is the useful thing anyway, because the gap it
 * closes is real: a buyer standing at a laptop has bKash on a phone that has
 * none of this on it, and their alternative is copying eleven digits and an
 * eight-character code across by eye. Scanning moves the whole page — number,
 * amount, reference, Copy buttons and the walkthrough — onto the device that
 * can actually pay.
 *
 * On a phone it is redundant, so the page does not show it there.
 *
 * Nothing is stored. The URL is derived from the intent id that was already in
 * the request, and the image is rendered per request from that.
 */

/** Big enough to scan off a laptop screen from arm's length, and no bigger. */
const PNG_WIDTH = 512

/** A bare host, optionally with a port. Anything else came from a header. */
const HOST_PATTERN = /^[a-z0-9.-]+(:\d+)?$/i

/**
 * Where the buyer actually is, preferred over `APP_URL`.
 *
 * `APP_URL` is one setting away from being wrong, and when it is wrong here the
 * failure is silent and expensive: the page looks perfect, the QR scans, and it
 * opens nothing. That is not hypothetical — the value in this repo's own `.env`
 * points at a port the dev server does not use, which is how this was found.
 *
 * The request cannot drift the same way. The buyer reached this page at some
 * origin, so that origin demonstrably works for them, and it stays correct for
 * a merchant serving Jomma from their own domain.
 *
 * Header-derived, so both parts are checked rather than interpolated: a `Host`
 * carrying a slash would otherwise smuggle a path into the link. A request can
 * only ever mis-address its own QR — the browser sets `Host` from the URL it is
 * loading — and the route sends `no-store` so no shared cache holds the result.
 */
export function requestOrigin(request: Request): string {
  const fallback = env().APP_URL
  const url = new URL(request.url)

  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? url.host
  if (!HOST_PATTERN.test(host)) return fallback

  // TLS usually terminates at the proxy, so the protocol on the inbound request
  // says http even when the buyer is on https. Encoding that would hand them a
  // downgrade and a redirect.
  const forwarded = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim()
  const proto = forwarded ?? url.protocol.replace(':', '')
  if (proto !== 'http' && proto !== 'https') return fallback

  return `${proto}://${host}`
}

/** The buyer-facing link for an intent. Absolute, because a QR has no origin. */
export function payPageUrl(publicId: string, origin: string = env().APP_URL): string {
  return new URL(`/pay/${publicId}`, origin).toString()
}

/**
 * A PNG of that link.
 *
 * Black on white with a real quiet zone, whatever the page theme is doing. A
 * QR tinted to match the design is one that fails under a phone camera in bad
 * light, and the buyer has no way to tell that the colours were the problem.
 *
 * Error correction stays at M: the payload is short, and the higher levels buy
 * resilience this will never need at the cost of a denser grid.
 */
export function renderPayQrPng(publicId: string, origin?: string): Promise<Buffer> {
  return QRCode.toBuffer(payPageUrl(publicId, origin), {
    type: 'png',
    errorCorrectionLevel: 'M',
    margin: 3,
    width: PNG_WIDTH,
    color: { dark: '#000000ff', light: '#ffffffff' },
  })
}
