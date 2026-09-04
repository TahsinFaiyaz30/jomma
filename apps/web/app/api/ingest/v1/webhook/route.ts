import { createHmac, timingSafeEqual } from 'node:crypto'
import { parseSignatureHeader, WEBHOOK_TOLERANCE_SECONDS } from '@jomma/shared'
import { env } from '@jomma/shared/env'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { ApiError } from '@/lib/api/errors'
import { enforceRateLimit, route } from '@/lib/api/handler'
import { db } from '@/lib/db/client'
import { receivingAccounts } from '@/lib/db/schema'
import { logger } from '@/lib/logger'
import { ingestManualEntry } from '@/lib/services/manual-entry'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const bodySchema = z.object({
  /** Which number this message landed on. */
  msisdn: z.string().trim().min(10).max(20),
  /** The message, verbatim. Never pre-parsed by the sender. */
  raw: z.string().min(1).max(4000),
  /** Optional: lets the bridge label itself distinctly in the feed. */
  source: z.enum(['bridge', 'generic_webhook']).default('generic_webhook'),
})

/**
 * POST /ingest/v1/webhook
 *
 * The signed endpoint any future capture source can POST to — the
 * `generic_webhook` adapter in AGENTS.md, and what the Messages bridge uses.
 *
 * Authenticated by HMAC over `${timestamp}.${rawBody}` with
 * `WEBHOOK_SIGNING_SECRET`, the same construction Jomma uses for its *outbound*
 * webhooks. Five-minute tolerance, constant-time comparison, so a captured
 * request cannot be replayed tomorrow.
 *
 * Deliberately no device token: this path exists for sources that are not
 * devices and have no provisioning story. It is rate limited, every rejection
 * is logged with its IP, and the shared secret is the entire authority — which
 * is why it is a separate secret from anything a client app ever sees.
 */
export const POST = route(async (request, context) => {
  enforceRateLimit(context, 'device:capture', context.ip ?? 'unknown')

  // Read the body as text first — the signature covers these exact bytes, and
  // re-serialising a parsed object would change them.
  const rawBody = await request.text()
  verifySignature(rawBody, request.headers.get('x-jomma-signature'), context.ip)

  let payload: unknown
  try {
    payload = JSON.parse(rawBody)
  } catch {
    throw new ApiError('validation_failed', 'Request body is not valid JSON.')
  }

  const parsed = bodySchema.safeParse(payload)
  if (!parsed.success) throw ApiError.validation(parsed.error)

  const digits = parsed.data.msisdn.replace(/\D/g, '').slice(-10)
  const account = (
    await db.select().from(receivingAccounts).where(eq(receivingAccounts.status, 'active'))
  ).find((row) => row.msisdn.replace(/\D/g, '').endsWith(digits))

  if (!account) {
    context.log.warn({ ip: context.ip }, 'ingest webhook for an unknown receiving number')
    throw ApiError.notFound('No active receiving account for that number.')
  }

  const result = await ingestManualEntry({
    receivingAccountId: account.id,
    raw: parsed.data.raw,
    // No human behind this one; the audit trail records the system as actor.
    actorId: '00000000-0000-0000-0000-000000000000',
    requestId: context.requestId,
    source: parsed.data.source === 'bridge' ? 'bridge' : 'generic_webhook',
    adapter: parsed.data.source === 'bridge' ? 'messages_bridge' : 'generic_webhook',
  })

  return {
    status: 200,
    body: {
      status: result.status,
      trx_id: result.trxId,
      matched: result.matched,
      request_id: context.requestId,
    },
  }
})

function verifySignature(rawBody: string, header: string | null, ip: string | null): void {
  const parsed = parseSignatureHeader(header)
  if (!parsed) throw ApiError.unauthorized('Missing or malformed X-Jomma-Signature.')

  const age = Math.abs(Math.floor(Date.now() / 1000) - parsed.timestamp)
  if (age > WEBHOOK_TOLERANCE_SECONDS) {
    throw ApiError.unauthorized('Signature timestamp is outside the tolerance window.')
  }

  const expected = createHmac('sha256', env().WEBHOOK_SIGNING_SECRET)
    .update(`${parsed.timestamp}.${rawBody}`)
    .digest('hex')

  const matches = parsed.signatures.some((candidate) => {
    const left = Buffer.from(candidate, 'utf8')
    const right = Buffer.from(expected, 'utf8')
    if (left.length !== right.length) return false
    return timingSafeEqual(left, right)
  })

  if (!matches) {
    // Every rejected request is logged with its IP, per AGENTS.md.
    logger.warn({ ip }, 'ingest webhook signature rejected')
    throw ApiError.unauthorized('Signature does not match.')
  }
}
