import { createHmac, timingSafeEqual } from 'node:crypto'
import { parseSignatureHeader, WEBHOOK_TOLERANCE_SECONDS } from '@jomma/shared'
import { env } from '@jomma/shared/env'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { ApiError } from '@/lib/api/errors'
import { enforceRateLimit, route } from '@/lib/api/handler'
import { msisdnSchema, multilineText } from '@/lib/api/schemas'
import { db } from '@/lib/db/client'
import { receivingAccounts } from '@/lib/db/schema'
import { logger } from '@/lib/logger'
import { canonicalMsisdn } from '@/lib/matching/normalize'
import { ingestManualEntry } from '@/lib/services/manual-entry'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const bodySchema = z.object({
  /**
   * Which number this message landed on.
   *
   * `msisdnSchema` rather than a bare length bound: the old one counted
   * *characters*, so `+++++++++1` passed as a ten-character string carrying a
   * single digit — and the lookup below then resolved it to a real account.
   */
  msisdn: msisdnSchema,
  /** The message, verbatim. Never pre-parsed by the sender. Line breaks are ordinary. */
  raw: multilineText(4000).min(1),
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

  /*
   * Which account this belongs to, by exact match on the stored form.
   *
   * It used to load every active receiving account on the instance and pick the
   * first whose digits *ended with* the submitted ones. Two things wrong with
   * that. A loosely-formatted number narrowed to almost nothing — one digit was
   * enough — and `find` then returned whichever unordered row happened to end
   * that way, so a fabricated payment could be posted into an account belonging
   * to a different business entirely. And it read the whole table on every call,
   * which on a hosted instance is a scan per message.
   *
   * Accounts are stored canonically, so the number can simply be put into that
   * same form and looked up on its unique index. No suffix, no candidates, no
   * first-row-wins.
   */
  const canonical = canonicalMsisdn(parsed.data.msisdn)
  const [account] = canonical
    ? await db
        .select()
        .from(receivingAccounts)
        .where(and(eq(receivingAccounts.msisdn, canonical), eq(receivingAccounts.status, 'active')))
        .limit(1)
    : []

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
