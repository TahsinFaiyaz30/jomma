import { env } from '@jomma/shared/env'
import { NextResponse } from 'next/server'
import { constantTimeEqual } from '@/lib/auth/tokens'
import { isJobGroup, runJobs } from '@/lib/jobs'
import { logger } from '@/lib/logger'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
/** Long enough for a webhook batch against a slow endpoint. */
export const maxDuration = 60

/**
 * The scheduling surface.
 *
 * Everything that runs on a timer runs here. `apps/worker` calls this on four
 * cadences; a hosted deployment with no persistent process points a cron service
 * at the same URL and gets identical behaviour, because both end up in the same
 * `runJobs`.
 *
 * `?group=` selects a cadence — `sweep`, `webhooks`, `health`, `maintenance`, or
 * `all`. A host that can only manage a single cron entry calls `all` on the
 * tightest interval and is correct, just noisier.
 *
 * Authenticated with the shared `AUTH_SECRET` rather than an API key: this is
 * not a tenant-facing surface and must never be reachable with one.
 *
 * GET is accepted as well as POST, because several hosted cron services only
 * issue GETs. Same secret, same header, same work.
 */
async function handle(request: Request) {
  const presented =
    request.headers.get('x-jomma-internal') ??
    request.headers.get('authorization')?.replace(/^Bearer /i, '') ??
    null

  if (!presented || !constantTimeEqual(presented, env().AUTH_SECRET)) {
    logger.warn({ ip: request.headers.get('x-forwarded-for') }, 'rejected internal sweep call')
    return NextResponse.json({ error: { code: 'unauthorized' } }, { status: 401 })
  }

  const requested = new URL(request.url).searchParams.get('group')
  const group = isJobGroup(requested) ? requested : 'all'

  const result = await runJobs(group)

  // Only log when something happened. A cron ping every minute that logs a line
  // every minute buries the lines that matter.
  const didSomething = Object.entries(result).some(
    ([key, value]) => key !== 'ms' && key !== 'group' && typeof value === 'number' && value > 0,
  )
  if (didSomething) logger.info(result, 'scheduled jobs ran')

  return NextResponse.json(result)
}

export const POST = handle
export const GET = handle
