import type { Metadata } from 'next'
import { AccountsView, type AccountView } from '@/components/dash/accounts-view'
import { PageHeader } from '@/components/dash/page-header'
import { requireBusiness } from '@/lib/auth/tenancy'
import { listAccountAlerts } from '@/lib/services/account-admin'
import { listAccountHealth } from '@/lib/services/accounts'
import { listDevices } from '@/lib/services/devices'

export const metadata: Metadata = { title: 'Accounts' }
export const dynamic = 'force-dynamic'

export default async function AccountsPage() {
  const { business } = await requireBusiness()
  const health = await listAccountHealth(business.id)

  const accounts: AccountView[] = await Promise.all(
    health.map(async (account) => ({
      id: account.id,
      provider: account.provider,
      msisdn: account.msisdn,
      label: account.label,
      status: account.status,
      statusReason: account.statusReason,
      heartbeatStale: account.heartbeatStale,
      balanceDrift: account.balanceDrift,
      balanceDriftCents: account.balanceDriftCents,
      routable: account.routable,
      lastHeartbeatAt: account.lastHeartbeatAt?.toISOString() ?? null,
      lastCaptureAt: account.lastCaptureAt?.toISOString() ?? null,
      lastKnownBalanceCents: account.lastKnownBalanceCents,
      dailyUsedCents: account.dailyUsedCents,
      dailyLimitCents: account.dailyLimitCents,
      monthlyUsedCents: account.monthlyUsedCents,
      monthlyLimitCents: account.monthlyLimitCents,
      utilization: account.utilization,
      capture: account.capture,
      devices: await listDevices(account.id),
      alerts: await listAccountAlerts(account.id),
    })),
  )

  const routable = accounts.filter((account) => account.routable).length

  return (
    <div className="flex h-svh min-h-0 flex-col">
      <PageHeader
        title="Accounts"
        description={
          accounts.length < 2
            ? 'One account is a single point of failure — add a second number and phone'
            : `${routable} of ${accounts.length} accepting payments`
        }
      />
      <AccountsView accounts={accounts} />
    </div>
  )
}
