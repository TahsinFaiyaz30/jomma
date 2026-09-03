import { AppSidebar } from '@/components/dash/app-sidebar'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { getAccountFooter, getSidebarCounts } from '@/lib/services/dashboard'

/**
 * The dashboard shell.
 *
 * ⚠ Unauthenticated. Better Auth is not wired yet (PROMPTS.md step 8), so these
 * routes are open to anyone who can reach the origin. Fine on localhost, not
 * fine anywhere else — see the production guard below.
 */
export const dynamic = 'force-dynamic'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  if (process.env.NODE_ENV === 'production' && !process.env.JOMMA_ALLOW_UNAUTHENTICATED_DASHBOARD) {
    throw new Error(
      'The dashboard has no authentication yet. Wire Better Auth before deploying, or set ' +
        'JOMMA_ALLOW_UNAUTHENTICATED_DASHBOARD=1 if the origin is protected some other way.',
    )
  }

  const [counts, accounts] = await Promise.all([getSidebarCounts(), getAccountFooter()])

  return (
    <SidebarProvider>
      <AppSidebar
        counts={counts}
        accounts={accounts.map((account) => ({
          id: account.id,
          provider: account.provider,
          msisdn: account.msisdn,
          label: account.label,
          status: account.status,
          lastHeartbeatAt: account.lastHeartbeatAt?.toISOString() ?? null,
          lastCaptureAt: account.lastCaptureAt?.toISOString() ?? null,
          heartbeatStale: account.heartbeatStale,
          balanceDrift: account.balanceDrift,
          routable: account.routable,
          utilization: account.utilization,
          openAlerts: account.openAlerts,
        }))}
      />
      <SidebarInset className="min-w-0">{children}</SidebarInset>
    </SidebarProvider>
  )
}
