import { NextResponse } from 'next/server'
import { getFeed } from '@/lib/services/dashboard'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Feed polling endpoint.
 *
 * Deliberately not part of `/v1` — this is dashboard chrome, not the client API,
 * and it returns things (raw parse status, device source) that no tenant should
 * see. It inherits the dashboard's authentication, which is to say it currently
 * has none; see the guard in app/(dash)/layout.tsx.
 *
 * Polling rather than SSE: a 2-second poll on a single-operator dashboard costs
 * one indexed query, survives a dev-server restart without reconnect logic, and
 * has no proxy-buffering failure mode. Revisit if this ever serves many
 * simultaneous viewers.
 */
export async function GET(request: Request) {
  const url = new URL(request.url)
  const sinceParam = url.searchParams.get('since')
  const since = sinceParam ? new Date(sinceParam) : null

  const page = await getFeed({
    limit: since ? 100 : 300,
    since: since && !Number.isNaN(since.getTime()) ? since : null,
  })

  return NextResponse.json(page, {
    headers: { 'cache-control': 'no-store' },
  })
}
