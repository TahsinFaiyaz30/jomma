import type { Metadata } from 'next'
import { FeedTable } from '@/components/dash/feed-table'
import { PageHeader } from '@/components/dash/page-header'
import { requireBusiness } from '@/lib/auth/tenancy'
import { getTranslator } from '@/lib/i18n/server'
import { getFeed } from '@/lib/services/dashboard'

export const metadata: Metadata = { title: 'Feed' }
export const dynamic = 'force-dynamic'

/**
 * The Feed. The hero of the product.
 *
 * Server-rendered first page so there is content before hydration, then the
 * client component takes over polling. No KPI tiles across the top — counts live
 * on the sidebar nav where they are always visible.
 */
export default async function FeedPage() {
  const { business } = await requireBusiness()
  const [t, page] = await Promise.all([getTranslator(), getFeed(business.id, { limit: 300 })])

  return (
    <div className="flex h-svh min-h-0 flex-col">
      <PageHeader title={t('feed.title')} />
      <FeedTable initialRows={page.rows} initialCursor={page.cursor} />
    </div>
  )
}
