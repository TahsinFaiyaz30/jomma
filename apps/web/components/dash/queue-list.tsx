'use client'

import { useCallback, useEffect, useRef, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { approveAction, rejectAction } from '@/app/(dash)/queue/actions'
import { StatusDot } from '@/components/status'
import { Button } from '@/components/ui/button'
import { Kbd, KbdGroup } from '@/components/ui/kbd'
import { Separator } from '@/components/ui/separator'
import { Spinner } from '@/components/ui/spinner'
import { formatMsisdn } from '@/lib/i18n/format'
import { useI18n } from '@/lib/i18n/provider'
import type { QueueCandidate, QueueItem } from '@/lib/services/queue'
import { cn } from '@/lib/utils'

/**
 * The manual queue.
 *
 * Approving must never require a pointer, so every action here has a key: j/k
 * to move between payments, [ and ] to move between that payment's candidates,
 * `a` to approve the highlighted candidate, `r` to reject the payment.
 */
export function QueueList({ items }: { items: QueueItem[] }) {
  const [activeItem, setActiveItem] = useState(0)
  const [activeCandidate, setActiveCandidate] = useState(0)
  const [pending, startTransition] = useTransition()
  const containerRef = useRef<HTMLDivElement>(null)

  const current = items[activeItem]

  useEffect(() => {
    setActiveCandidate(0)
  }, [])

  const approve = useCallback((item: QueueItem, candidate: QueueCandidate | undefined) => {
    if (!candidate) {
      toast.error('No candidate selected.')
      return
    }
    startTransition(async () => {
      const result = await approveAction(item.paymentId, candidate.intentId)
      if (result.ok) toast.success(result.message)
      else toast.error(result.message)
    })
  }, [])

  const reject = useCallback((item: QueueItem) => {
    startTransition(async () => {
      const result = await rejectAction(item.paymentId)
      if (result.ok) toast.success(result.message)
      else toast.error(result.message)
    })
  }, [])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null
      if (
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.isContentEditable
      ) {
        return
      }
      if (items.length === 0 || pending) return

      const item = items[activeItem]

      switch (event.key) {
        case 'j':
        case 'ArrowDown':
          event.preventDefault()
          setActiveItem((index) => Math.min(index + 1, items.length - 1))
          setActiveCandidate(0)
          break
        case 'k':
        case 'ArrowUp':
          event.preventDefault()
          setActiveItem((index) => Math.max(index - 1, 0))
          setActiveCandidate(0)
          break
        case ']':
          event.preventDefault()
          if (item) setActiveCandidate((i) => Math.min(i + 1, item.candidates.length - 1))
          break
        case '[':
          event.preventDefault()
          setActiveCandidate((i) => Math.max(i - 1, 0))
          break
        case 'a':
          event.preventDefault()
          if (item) approve(item, item.candidates[activeCandidate])
          break
        case 'r':
          event.preventDefault()
          if (item) reject(item)
          break
        default:
          break
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [items, activeItem, activeCandidate, approve, reject, pending])

  useEffect(() => {
    const node = containerRef.current?.querySelector<HTMLElement>('[data-active="true"]')
    node?.scrollIntoView({ block: 'nearest' })
  }, [])

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-1.5 px-6 py-24 text-center">
        <StatusDot tone="matched" />
        <div className="mt-1 text-body">Queue is empty</div>
        <div className="max-w-sm text-small text-muted-foreground">
          Every observed payment is either matched or already dealt with. Payments the matcher
          refuses to guess at land here.
        </div>
      </div>
    )
  }

  return (
    <div ref={containerRef} className="min-h-0 flex-1 overflow-auto">
      <ShortcutBar />
      <div className="divide-y divide-border">
        {items.map((item, index) => (
          <QueueRow
            key={item.paymentId}
            item={item}
            active={index === activeItem}
            activeCandidate={index === activeItem ? activeCandidate : -1}
            pending={pending && index === activeItem}
            onFocus={() => {
              setActiveItem(index)
              setActiveCandidate(0)
            }}
            onSelectCandidate={setActiveCandidate}
            onApprove={(candidate) => approve(item, candidate)}
            onReject={() => reject(item)}
          />
        ))}
      </div>
      <span className="sr-only" aria-live="polite">
        {current ? `Payment ${activeItem + 1} of ${items.length}` : ''}
      </span>
    </div>
  )
}

function ShortcutBar() {
  return (
    <div className="flex flex-wrap items-center gap-3 border-border border-b px-4 py-2 text-micro text-muted-foreground">
      <span className="inline-flex items-center gap-1.5">
        <KbdGroup>
          <Kbd>j</Kbd>
          <Kbd>k</Kbd>
        </KbdGroup>
        payment
      </span>
      <span className="inline-flex items-center gap-1.5">
        <KbdGroup>
          <Kbd>[</Kbd>
          <Kbd>]</Kbd>
        </KbdGroup>
        candidate
      </span>
      <span className="inline-flex items-center gap-1.5">
        <Kbd>a</Kbd> approve
      </span>
      <span className="inline-flex items-center gap-1.5">
        <Kbd>r</Kbd> reject
      </span>
    </div>
  )
}

function QueueRow({
  item,
  active,
  activeCandidate,
  pending,
  onFocus,
  onSelectCandidate,
  onApprove,
  onReject,
}: {
  item: QueueItem
  active: boolean
  activeCandidate: number
  pending: boolean
  onFocus: () => void
  onSelectCandidate: (index: number) => void
  onApprove: (candidate: QueueCandidate | undefined) => void
  onReject: () => void
}) {
  const { amount, clock, elapsed } = useI18n()

  return (
    <section
      data-active={active}
      // Focus, not click: the row is a container, not a control. Tabbing to any
      // button inside it selects that payment, which keeps mouse and keyboard on
      // the same code path instead of bolting a click handler onto a <section>.
      onFocusCapture={onFocus}
      className={cn(
        'px-4 py-3 transition-colors',
        active ? 'border-l-2 border-l-primary bg-accent pl-[14px]' : 'hover:bg-accent/50',
      )}
    >
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span className="amount text-title font-medium">
          {item.amountCents === null ? (
            <span className="text-muted-foreground">unreadable</span>
          ) : (
            amount(item.amountCents)
          )}
        </span>
        <span className="figure text-small text-muted-foreground">
          {formatMsisdn(item.senderMsisdn)}
        </span>
        <span className="figure text-small text-muted-foreground">{item.trxId ?? '—'}</span>
        <span className="ml-auto text-small text-muted-foreground">
          {/* Age is the priority here, so it gets a whole column of its own. */}
          waiting {elapsed(item.receivedAt)} · {clock(item.receivedAt)}
        </span>
      </div>

      <div className="mt-1 flex items-center gap-2">
        <StatusDot tone={item.parseStatus === 'failed' ? 'offline' : 'ambiguous'} />
        <span className="text-small text-ambiguous-subtle-foreground">{item.reason}</span>
        <span className="text-micro text-muted-foreground">
          · {item.accountLabel} · via {item.source}
        </span>
      </div>

      {item.parseStatus === 'failed' ? (
        <pre className="mt-2 max-w-full overflow-x-auto whitespace-pre-wrap rounded-md border border-border bg-card px-3 py-2 text-micro text-muted-foreground">
          {item.rawMessage}
        </pre>
      ) : null}

      {active ? (
        <>
          <Separator className="my-3" />
          {item.candidates.length === 0 ? (
            <div className="flex items-center justify-between gap-4">
              <p className="text-small text-muted-foreground">
                No intent on this account is close enough to offer as a candidate.
              </p>
              <Button variant="outline" size="sm" onClick={onReject} disabled={pending}>
                {pending ? <Spinner /> : null}
                Reject
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              {item.candidates.map((candidate, index) => (
                <CandidateRow
                  key={candidate.intentId}
                  candidate={candidate}
                  paymentAmount={item.amountCents}
                  selected={index === activeCandidate}
                  pending={pending}
                  onSelect={() => onSelectCandidate(index)}
                  onApprove={() => onApprove(candidate)}
                />
              ))}
              <div className="flex justify-end pt-1">
                <Button variant="ghost" size="sm" onClick={onReject} disabled={pending}>
                  Reject — nothing here claims it
                </Button>
              </div>
            </div>
          )}
        </>
      ) : null}
    </section>
  )
}

function CandidateRow({
  candidate,
  paymentAmount,
  selected,
  pending,
  onSelect,
  onApprove,
}: {
  candidate: QueueCandidate
  paymentAmount: number | null
  selected: boolean
  pending: boolean
  onSelect: () => void
  onApprove: () => void
}) {
  const { amount, delta } = useI18n()
  const d = candidate.diagnosis

  return (
    <div
      data-selected={selected}
      // Selecting on hover would make the pointer fight the [ and ] keys for
      // control of the same state. Focus is the shared signal.
      onFocusCapture={onSelect}
      className={cn(
        'flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border px-3 py-2',
        selected ? 'border-primary bg-background' : 'border-border bg-card',
      )}
    >
      <span className="figure text-small">{candidate.refCode ?? '—'}</span>
      <span className="text-small text-muted-foreground">{candidate.clientReference}</span>
      <span className="amount text-small">{amount(candidate.outstandingCents)}</span>

      {/* The discrepancies, spelled out. This is what the operator is deciding on. */}
      <div className="flex flex-wrap items-center gap-1.5">
        {d.amountDeltaCents === 0 ? (
          <Chip tone="matched">amount exact</Chip>
        ) : d.amountDeltaCents === null ? (
          <Chip tone="offline">no amount</Chip>
        ) : (
          <Chip tone="offline">off by {delta(d.amountDeltaCents)}</Chip>
        )}

        {d.referenceExact ? (
          <Chip tone="matched">reference exact</Chip>
        ) : d.referenceDistance === 1 ? (
          <Chip tone="ambiguous">reference off by 1</Chip>
        ) : d.referenceDistance === null ? (
          <Chip tone="neutral">no reference</Chip>
        ) : (
          <Chip tone="neutral">reference distance {d.referenceDistance}</Chip>
        )}

        {d.senderMatches ? <Chip tone="matched">sender matches</Chip> : null}
        {d.senderConflicts ? <Chip tone="ambiguous">different sender</Chip> : null}
        {d.holdsLock ? <Chip tone="matched">holds the lock</Chip> : null}
        {d.withinWindow ? null : <Chip tone="neutral">outside the window</Chip>}
        {candidate.status === 'expired' ? <Chip tone="neutral">intent expired</Chip> : null}
      </div>

      <span className="ml-auto flex items-center gap-2">
        <span className="figure text-micro text-muted-foreground">
          {Number.isFinite(d.score) ? `score ${d.score}` : 'gated'}
        </span>
        <Button
          size="sm"
          onClick={onApprove}
          disabled={pending || paymentAmount === null}
          variant={selected ? 'default' : 'outline'}
        >
          {pending && selected ? <Spinner /> : null}
          Approve
        </Button>
      </span>
    </div>
  )
}

function Chip({
  tone,
  children,
}: {
  tone: 'matched' | 'ambiguous' | 'offline' | 'neutral'
  children: React.ReactNode
}) {
  const classes = {
    matched: 'bg-matched-subtle text-matched-subtle-foreground',
    ambiguous: 'bg-ambiguous-subtle text-ambiguous-subtle-foreground',
    offline: 'bg-offline-subtle text-offline-subtle-foreground',
    neutral: 'bg-muted text-muted-foreground',
  }[tone]

  return (
    <span className={cn('rounded-full px-2 py-0.5 text-micro whitespace-nowrap', classes)}>
      {children}
    </span>
  )
}
