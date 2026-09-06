import { NextResponse } from 'next/server'
import { getAdmin } from '@/lib/auth/session'
import { getActiveBusiness } from '@/lib/auth/tenancy'
import { logger } from '@/lib/logger'
import { getFeed } from '@/lib/services/dashboard'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Feed polling endpoint.
 *
 * Deliberately not part of `/v1` — this is dashboard chrome, not the client API,
 * and it returns things no tenant should see: raw parse status, capture source,
 * every sender's number and every TrxID across every account.
 *
 * Which is exactly why it authenticates. A route handler does **not** inherit
 * the guard in `app/(dash)/layout.tsx`: that protects the page, and this is a
 * separate entry point reachable directly. It was left open on the assumption
 * that it was covered, and it was not — an unauthenticated GET returned three
 * hundred payment records with phone numbers and transaction ids in them.
 *
 * `getAdmin` rather than `requireAdmin`, because the latter redirects and a
 * poller wants a 401 it can recognise, not an HTML login page.
 *
 * Polling rather than SSE: a 2-second poll on a single-operator dashboard costs
 * one indexed query, survives a dev-server restart without reconnect logic, and
 * has no proxy-buffering failure mode.
 */
export async function GET(request: Request) {
  const admin = await getAdmin()
  if (!admin) {
    logger.warn(
      { ip: request.headers.get('x-forwarded-for'), path: '/api/dash/feed' },
      'unauthenticated dashboard feed request',
    )
    return NextResponse.json(
      { error: { code: 'unauthorized', message: 'Sign in required.' } },
      { status: 401, headers: { 'cache-control': 'no-store' } },
    )
  }

  /*
   * Which business the poll is for. Resolved from the session, not from the
   * query string — this route is hit every two seconds and returns raw capture
   * text, so a `businessId` parameter would be the cheapest cross-tenant read
   * on the instance.
   */
  const business = await getActiveBusiness(admin)
  if (!business) {
    return NextResponse.json(
      { error: { code: 'no_business', message: 'No business selected.' } },
      { status: 404, headers: { 'cache-control': 'no-store' } },
    )
  }

  const url = new URL(request.url)
  const sinceParam = url.searchParams.get('since')
  const since = sinceParam ? new Date(sinceParam) : null

  const page = await getFeed(business.id, {
    limit: since ? 100 : 300,
    since: since && !Number.isNaN(since.getTime()) ? since : null,
  })

  return NextResponse.json(page, {
    headers: { 'cache-control': 'no-store' },
  })
}
