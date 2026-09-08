import { fromPublicId } from '@jomma/shared'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { PayClient } from '@/components/pay/pay-client'
import { handoffIsLive } from '@/lib/services/handoff'
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

export default async function PayPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ h?: string | string[] }>
}) {
  const { id } = await params
  const view = await getPayView(id)

  // Same answer for a malformed id and one that does not exist.
  if (!view) notFound()

  /*
   * `?h=` means this page was opened by scanning the QR on another screen, and
   * it decides the whole shape of what follows: a live token skips the queue of
   * questions the other screen already answered and removes the way back, a
   * dead one says so rather than quietly starting over.
   *
   * Resolved on the server, because the alternative is shipping the comparison
   * to a browser holding both sides of it. A repeated `?h=a&h=b` arrives as an
   * array, which nobody minted and nothing can match — so it counts as having
   * presented nothing, rather than being joined into a string and then reported
   * as a cancelled session to somebody who never had one.
   */
  const { h } = await searchParams
  const presented = typeof h === 'string' ? h : ''
  const uuid = fromPublicId('intent', view.id)

  const handoff =
    presented.length === 0
      ? 'none'
      : uuid && (await handoffIsLive(uuid, presented))
        ? 'live'
        : 'revoked'

  return <PayClient initial={view} handoff={handoff} handoffToken={presented || null} />
}
