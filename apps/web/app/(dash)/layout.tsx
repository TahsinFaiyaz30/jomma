import { redirect } from 'next/navigation'
import { AppSidebar } from '@/components/dash/app-sidebar'
import { CommandPalette } from '@/components/dash/command-palette'
import { NotPayableBanner } from '@/components/dash/not-payable-banner'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { requireBusiness } from '@/lib/auth/tenancy'
import { getAccountFooter, getSidebarCounts } from '@/lib/services/dashboard'
import { canTakePayments, hasCompletedSetup } from '@/lib/services/onboarding'

/**
 * The dashboard shell.
 *
 * Every route under this layout requires a signed-in admin. `requireAdmin`
 * redirects to /login rather than rendering an empty shell, so there is no state
 * where the chrome is visible without a session behind it.
 */
export const dynamic = 'force-dynamic'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  /*
   * Resolves the signed-in user *and* which business they are acting on, and
   * every read below is scoped by it. Self-hosted there is exactly one and this
   * is indistinguishable from what it did before; as a service it is the line
   * between two merchants.
   */
  const { user: admin, business } = await requireBusiness()

  /*
   * A deployment that has never been set up gets sent to set itself up. One
   * that *has* been, and is currently broken, gets told so and left alone.
   *
   * The distinction matters because they look identical to a capability check
   * and are nothing alike to the person on the other side. Disabling an account
   * is a one-click action on the Accounts page — the documented way to take a
   * number out of rotation while a phone is away — and doing it to your only
   * account should not hide your payment history behind a first-run wizard.
   *
   * So the gate reads a stamp that is never cleared, and the live capability
   * check downgrades to a banner once that stamp exists.
   */
  if (!(await hasCompletedSetup())) redirect('/setup')

  const [counts, accounts, payable] = await Promise.all([
    getSidebarCounts(),
    getAccountFooter(business.id),
    canTakePayments(),
  ])

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
      <SidebarInset className="min-w-0">
        {payable ? null : <NotPayableBanner />}
        {children}
      </SidebarInset>
      <CommandPalette />
    </SidebarProvider>
  )
}
