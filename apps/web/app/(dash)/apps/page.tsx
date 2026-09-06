import type { Metadata } from 'next'
import { AppsView } from '@/components/dash/apps-view'
import { PageHeader } from '@/components/dash/page-header'
import { requireBusiness } from '@/lib/auth/tenancy'
import { listApps } from '@/lib/services/app-admin'

export const metadata: Metadata = { title: 'Apps' }
export const dynamic = 'force-dynamic'

export default async function AppsPage() {
  const { business } = await requireBusiness()
  const apps = await listApps(business.id)
  const failed = apps.reduce((total, app) => total + app.deliveryCounts.failed, 0)

  return (
    <div className="flex h-svh min-h-0 flex-col">
      <PageHeader
        title="Apps"
        description={
          failed > 0
            ? `${failed} webhook deliver${failed === 1 ? 'y has' : 'ies have'} exhausted their retries`
            : `${apps.length} client app${apps.length === 1 ? '' : 's'}`
        }
      />
      <AppsView apps={apps} />
    </div>
  )
}
