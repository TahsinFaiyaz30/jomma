import { authenticateApp } from '@/lib/api/auth'
import { enforceRateLimit, route } from '@/lib/api/handler'
import { listAccountHealth } from '@/lib/services/accounts'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /v1/accounts
 *
 * Clients check this before rendering a pay page. `degraded` means the account
 * still works but something is wrong — surface a fallback rather than a dead end.
 *
 * Note what is deliberately absent: no device ids, no balances, no drift
 * amounts. A client app needs to know whether to route a payment here, not how
 * the shop's phone is doing.
 */
export const GET = route(async (request, context) => {
  const app = await authenticateApp(request)
  enforceRateLimit(context, 'accounts:list', app.rateKey)

  const accounts = await listAccountHealth(app.businessId)

  return {
    status: 200,
    body: {
      accounts: accounts.map((account) => ({
        provider: account.provider,
        msisdn: account.msisdn,
        display_name: account.label,
        status: account.routable
          ? account.status
          : account.status === 'active'
            ? 'degraded'
            : account.status,
        health: {
          last_heartbeat_at: account.lastHeartbeatAt?.toISOString() ?? null,
          last_capture_at: account.lastCaptureAt?.toISOString() ?? null,
          balance_drift: account.balanceDrift,
        },
        limits: {
          daily_used: account.dailyUsedCents,
          daily_limit: account.dailyLimitCents,
          utilization: Number(account.utilization.toFixed(4)),
        },
      })),
      request_id: context.requestId,
    },
  }
})
