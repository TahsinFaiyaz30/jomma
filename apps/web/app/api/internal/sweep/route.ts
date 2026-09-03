import { env } from '@jomma/shared/env'
import { NextResponse } from 'next/server'
import { constantTimeEqual } from '@/lib/auth/tokens'
import { logger } from '@/lib/logger'
import { expireDueIntents } from '@/lib/services/intents'
import { retryOrphans } from '@/lib/services/match-runner'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Internal job endpoint, called by the worker.
 *
 * The worker owns *scheduling*; the web app owns every decision that touches
 * money. Intent expiry emits a `payment.expired` webhook and releases a lock,
 * and orphan re-matching runs the scorer and can approve a payment — so both
 * live here, behind the one implementation of `applyPayment`, rather than being
 * reimplemented in a second process.
 *
 * Authenticated with the shared `AUTH_SECRET` rather than an API key: this is
 * not a tenant-facing surface and must never be reachable with one.
 */
export async function POST(request: Request) {
  const presented = request.headers.get('x-jomma-internal')
  if (!presented || !constantTimeEqual(presented, env().AUTH_SECRET)) {
    logger.warn({ ip: request.headers.get('x-forwarded-for') }, 'rejected internal sweep call')
    return NextResponse.json({ error: { code: 'unauthorized' } }, { status: 401 })
  }

  const startedAt = Date.now()

  const [expired, rematched] = await Promise.all([
    expireDueIntents().catch((error) => {
      logger.error({ err: error }, 'expiry sweep failed')
      return 0
    }),
    retryOrphans().catch((error) => {
      logger.error({ err: error }, 'orphan retry failed')
      return 0
    }),
  ])

  return NextResponse.json({
    expired,
    rematched,
    ms: Date.now() - startedAt,
  })
}
