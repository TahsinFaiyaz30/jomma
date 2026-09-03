import { AppSidebar } from '@/components/dash/app-sidebar'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { requireAdmin } from '@/lib/auth/session'
import { getAccountFooter, getSidebarCounts } from '@/lib/services/dashboard'

/**
 * The dashboard shell.
 *
 * Every route under this layout requires a signed-in admin. `requireAdmin`
 * redirects to /login rather than rendering an empty shell, so there is no state
 * where the chrome is visible without a session behind it.
 */
export const dynamic = 'force-dynamic'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const admin = await requireAdmin()

  const [counts, accounts] = await Promise.all([getSidebarCounts(), getAccountFooter()])

  return (
    <SidebarProvider>
      <AppSidebar
        counts={counts}
        admin={admin}
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
