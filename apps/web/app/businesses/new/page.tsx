import { isServiceMode } from '@jomma/shared/env'
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { NewBusinessForm } from '@/components/businesses/new-business-form'
import { requireAdmin } from '@/lib/auth/session'

/**
 * Where a new signup lands, and where "add another business" goes.
 *
 * Outside the dashboard shell, like the setup wizard and for the same reason:
 * the sidebar links to screens that cannot show anything yet, so rendering it
 * would be offering exits from the one page that matters.
 *
 * Deliberately reachable by someone who already has a business. Running two
 * shops off one login is an ordinary case in this market, not a mistake worth
 * blocking.
 */
export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Register your business' }

export default async function NewBusinessPage() {
  const user = await requireAdmin()

  // Self-hosted there is one business, created on first run. A second would
  // silently split the instance in half.
  if (!isServiceMode()) redirect('/')

  return <NewBusinessForm email={user.email} />
}
