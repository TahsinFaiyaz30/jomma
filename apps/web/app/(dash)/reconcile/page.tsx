import type { Metadata } from 'next'
import { PageHeader } from '@/components/dash/page-header'
import { StatusDot } from '@/components/status'
import {
  getOverdueIntentCount,
  getPaidWithoutPaymentCount,
  getParseFailureCount,
  getQueueDepth,
} from '@/lib/services/dashboard'
import { cn } from '@/lib/utils'

export const metadata: Metadata = { title: 'Reconcile' }
export const dynamic = 'force-dynamic'

/**
 * Reconciliation.
 *
 * Statement import is not built yet, but the integrity checks are — and the
 * important one is live: intents marked paid with no payment row behind them.
 * docs/matching.md says that list must always be empty, so it is surfaced here
 * whether or not the rest of the page exists.
 */
export default async function ReconcilePage() {
  const [paidWithoutPayment, overdue, parseFailures, queue] = await Promise.all([
    getPaidWithoutPaymentCount(),
    getOverdueIntentCount(),
    getParseFailureCount(),
    getQueueDepth(),
  ])

  return (
    <div className="flex h-svh min-h-0 flex-col">
      <PageHeader title="Reconcile" />
      <div className="min-h-0 flex-1 space-y-6 overflow-auto p-6">
        <section className="space-y-3">
          <h2 className="text-title font-medium">Integrity checks</h2>

          <Check
            label="Intents marked paid with no payment row"
            value={paidWithoutPayment}
            // The only check here where any non-zero value is a bug, not a
            // workload. Something wrote a paid status without money behind it.
            tone={paidWithoutPayment === 0 ? 'matched' : 'offline'}
            good="Empty, as it must always be."
            bad="Something recorded a payment that never arrived. Investigate immediately."
          />

          <Check
            label="Unmatched incoming payments"
            value={queue.depth}
            tone={queue.depth === 0 ? 'matched' : 'pending'}
            good="Every observed payment is claimed."
            bad="Money arrived that no intent claims. Normal in small numbers; work it from the queue."
          />

          <Check
            label="Parse failures in the last 24 hours"
            value={parseFailures}
            tone={parseFailures === 0 ? 'matched' : 'ambiguous'}
            good="Every message parsed."
            bad="A provider may have changed its message format. The raw text is stored — re-parse once the format is known."
          />

          <Check
            label="Open intents past their expiry"
            value={overdue}
            tone={overdue === 0 ? 'matched' : 'ambiguous'}
            good="The expiry sweep is keeping up."
            bad="The worker's expiry sweep is not running, or is behind."
          />
        </section>

        <section className="space-y-2">
          <h2 className="text-title font-medium">Statement import</h2>
          <p className="max-w-xl text-small text-muted-foreground">
            Not built yet. The weekly bKash CSV export imports with{' '}
            <span className="figure">source = statement</span>; the unique index on{' '}
            <span className="figure">trx_id</span> absorbs everything already known, and what
            remains is money the notifier never saw.
          </p>
        </section>
      </div>
    </div>
  )
}

function Check({
  label,
  value,
  tone,
  good,
  bad,
}: {
  label: string
  value: number
  tone: 'matched' | 'pending' | 'ambiguous' | 'offline'
  good: string
  bad: string
}) {
  const ok = value === 0
  return (
    <div
      className={cn(
        'flex items-start gap-3 rounded-lg border border-border p-3',
        !ok && tone === 'offline' && 'border-offline/40 bg-offline-subtle/30',
      )}
    >
      <StatusDot tone={tone} className="mt-1.5" pulse={!ok && tone === 'offline'} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-4">
          <span className="text-small">{label}</span>
          <span className="amount shrink-0 text-body font-medium">{value}</span>
        </div>
        <p className="mt-0.5 text-micro text-muted-foreground">{ok ? good : bad}</p>
      </div>
    </div>
  )
}
