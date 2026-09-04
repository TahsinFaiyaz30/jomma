import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { PayClient } from '@/components/pay/pay-client'
import { getPayView } from '@/lib/services/pay-page'

export const dynamic = 'force-dynamic'

/**
 * The hosted pay page.
 *
 * Public, outside the dashboard layout, and the one surface a buyer ever sees.
 * A store that cannot or will not build its own checkout screen redirects here
 * with a `return_url` and is done — which is what lets Jomma sit in front of an
 * ecommerce platform it knows nothing about.
 *
 * Rendered server-side from the database. There is no API key in the browser
 * because the browser never calls the client API.
 */

export const metadata: Metadata = {
  title: 'Complete your payment',
  // A payment link in someone's browser history or a search index helps nobody.
  robots: { index: false, follow: false },
}

export default async function PayPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const view = await getPayView(id)

  // Same answer for a malformed id and one that does not exist.
  if (!view) notFound()

  return <PayClient initial={view} />
}
