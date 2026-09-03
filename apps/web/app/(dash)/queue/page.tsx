import type { Metadata } from 'next'
import { PageHeader } from '@/components/dash/page-header'
import { QueueList } from '@/components/dash/queue-list'
import { getQueue } from '@/lib/services/queue'

export const metadata: Metadata = { title: 'Queue' }
export const dynamic = 'force-dynamic'

/**
 * Payments that need a human, oldest first.
 *
 * The matcher escalates here rather than ranking two close candidates.
 * Approving calls straight into `applyPayment` — the same transaction path as
 * automatic matching, not a second implementation of it.
 */
export default async function QueuePage() {
  const items = await getQueue()

  return (
    <div className="flex h-svh min-h-0 flex-col">
      <PageHeader
        title="Queue"
        description={
          items.length === 0
            ? 'Nothing waiting'
            : `${items.length} payment${items.length === 1 ? '' : 's'} waiting, oldest first`
        }
      />
      <QueueList items={items} />
    </div>
  )
}
