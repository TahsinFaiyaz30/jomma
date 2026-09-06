import type { Metadata } from 'next'
import { IntentsView } from '@/components/dash/intents-view'
import { PageHeader } from '@/components/dash/page-header'
import { requireBusiness } from '@/lib/auth/tenancy'
import { getIntentFilterOptions, listIntents } from '@/lib/services/intent-admin'
import { loadIntentDetail } from './actions'

export const metadata: Metadata = { title: 'Intents' }
export const dynamic = 'force-dynamic'

export default async function IntentsPage() {
  const { business } = await requireBusiness()
  const [intents, options] = await Promise.all([
    listIntents(business.id),
    getIntentFilterOptions(business.id),
  ])

  return (
    <div className="flex h-svh min-h-0 flex-col">
      <PageHeader
        title="Intents"
        description={`${options.counts.open} open · ${options.counts.matched} matched · ${options.counts.partial} partial`}
      />
      <IntentsView intents={intents} accounts={options.accounts} detailFor={loadIntentDetail} />
    </div>
  )
}
