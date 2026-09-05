import { redirect } from 'next/navigation'
import { AppSidebar } from '@/components/dash/app-sidebar'
import { CommandPalette } from '@/components/dash/command-palette'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { requireAdmin } from '@/lib/auth/session'
import { getAccountFooter, getSidebarCounts } from '@/lib/services/dashboard'
import { isSetupComplete } from '@/lib/services/onboarding'

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

  /*
   * An instance that cannot take a payment gets sent to set itself up.
   *
   * Not a dismissible banner. Until there is a routable account with a phone
   * behind it and a live API key, every screen under here is an empty table
   * whose empty state is indistinguishable from a quiet day — and the one thing
   * worth doing is not on any of them.
   *
   * The check is computed from the database rather than a flag, so it comes
   * back if the last account is disabled or the last key revoked. Nobody can
   * dismiss their way into a broken instance.
   */
  if (!(await isSetupComplete())) redirect('/setup')

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
      <CommandPalette />
    </SidebarProvider>
  )
}
