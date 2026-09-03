import type { Metadata } from 'next'
import { IntentsView } from '@/components/dash/intents-view'
import { PageHeader } from '@/components/dash/page-header'
import { getIntentFilterOptions, listIntents } from '@/lib/services/intent-admin'
import { loadIntentDetail } from './actions'

export const metadata: Metadata = { title: 'Intents' }
export const dynamic = 'force-dynamic'

export default async function IntentsPage() {
  const [intents, options] = await Promise.all([listIntents(), getIntentFilterOptions()])

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
