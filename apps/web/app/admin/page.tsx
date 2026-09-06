import type { Metadata } from 'next'
import Link from 'next/link'
import { ReviewQueue } from '@/components/admin/review-queue'
import { buttonVariants } from '@/components/ui/button'
import { requirePlatformAdmin } from '@/lib/auth/session'
import { listBusinessesForReview, pendingBusinessCount } from '@/lib/services/businesses'

/**
 * The platform console.
 *
 * Outside `(dash)` on purpose. That shell resolves an active business and
 * scopes everything to it, which is the wrong frame entirely here — this screen
 * is about the instance, and the person using it may well belong to no business
 * at all.
 */
export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Platform' }

export default async function AdminPage() {
  await requirePlatformAdmin()

  const [businesses, waiting] = await Promise.all([
    listBusinessesForReview(),
    pendingBusinessCount(),
  ])

  return (
    <div className="flex h-svh min-h-0 flex-col">
      {/*
        A plain header rather than the dashboard's `PageHeader`, which renders a
        `SidebarTrigger` and therefore needs a `SidebarProvider` this page does
        not have — and should not, since there is no business to put in a
        sidebar here.
      */}
      <header className="flex h-11 shrink-0 items-center gap-2 border-border border-b px-4">
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-medium text-title leading-none">Platform</h1>
          <p className="mt-0.5 truncate text-micro text-muted-foreground">
            {waiting === 0
              ? `${businesses.length} business${businesses.length === 1 ? '' : 'es'} registered`
              : `${waiting} waiting for a decision`}
          </p>
        </div>
        <Link href="/" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
          Back to dashboard
        </Link>
      </header>
      <div className="min-h-0 flex-1 overflow-auto">
        <ReviewQueue businesses={businesses} />
      </div>
    </div>
  )
}
