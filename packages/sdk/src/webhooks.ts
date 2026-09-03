import { createHmac, timingSafeEqual } from 'node:crypto'
import { SignatureVerificationError } from './errors.js'
import type { PaymentEventData, WebhookEvent } from './types.js'

/** Reject anything signed more than five minutes ago. */
export const DEFAULT_TOLERANCE_SECONDS = 300

function parseHeader(header: string): {
  timestamp: number
  signatures: string[]
} {
  let timestamp: number | null = null
  const signatures: string[] = []

  for (const part of header.split(',')) {
    const index = part.indexOf('=')
    if (index < 0) continue
    const key = part.slice(0, index).trim()
    const value = part.slice(index + 1).trim()
    if (key === 't') {
      const parsed = Number.parseInt(value, 10)
      if (Number.isFinite(parsed)) timestamp = parsed
    } else if (key === 'v1') {
      signatures.push(value)
    }
  }

  if (timestamp === null) throw new SignatureVerificationError('Signature header has no timestamp.')
  if (signatures.length === 0) {
    throw new SignatureVerificationError('Signature header has no v1 signature.')
  }

  return { timestamp, signatures }
}

function constantTimeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8')
  const right = Buffer.from(b, 'utf8')
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}

/**
 * Verifies a webhook and returns the parsed event.
 *
 * Pass the **raw** request body, not a re-serialised object — `JSON.parse` then
 * `JSON.stringify` can reorder keys and change whitespace, and the signature
 * covers the exact bytes that were sent.
 *
 * Throws on a bad signature or a stale timestamp. There is no "soft fail" mode
 * on purpose: an unverified `payment.succeeded` is an instruction to ship goods.
 */
export function constructEvent<T = PaymentEventData>(
  rawBody: string,
  signatureHeader: string | null | undefined,
  secret: string,
  options: { toleranceSeconds?: number; now?: Date } = {},
): WebhookEvent<T> {
  if (!signatureHeader) throw new SignatureVerificationError('Missing X-Jomma-Signature header.')
  if (!secret) throw new SignatureVerificationError('Missing webhook signing secret.')

  const tolerance = options.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS
  const { timestamp, signatures } = parseHeader(signatureHeader)

  const nowSeconds = Math.floor((options.now?.getTime() ?? Date.now()) / 1000)
  const age = Math.abs(nowSeconds - timestamp)
  if (age > tolerance) {
    throw new SignatureVerificationError(
      `Signature timestamp is ${age}s old, outside the ${tolerance}s tolerance.`,
    )
  }

  const expected = createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex')

  // Compare against every v1 value so a secret rotation that sends two
  // signatures verifies against either.
  const matched = signatures.some((candidate) => constantTimeEqual(candidate, expected))
  if (!matched) throw new SignatureVerificationError('Signature does not match.')

  try {
    return JSON.parse(rawBody) as WebhookEvent<T>
  } catch {
    throw new SignatureVerificationError('Body is not valid JSON.')
  }
}

/** Signs a payload the way Jomma does. Useful for testing your own receiver. */
export function signPayload(
  rawBody: string,
  secret: string,
  timestamp = Math.floor(Date.now() / 1000),
): string {
  const digest = createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex')
  return `t=${timestamp},v1=${digest}`
}
