'use client'

import { StatusDot } from '@/components/status'
import { Separator } from '@/components/ui/separator'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { formatMsisdn } from '@/lib/i18n/format'
import { useI18n } from '@/lib/i18n/provider'
import type { FeedRow } from '@/lib/services/dashboard'
import type { StatusTone } from '@/lib/status'
import { TONE_CLASSES } from '@/lib/status'
import { cn } from '@/lib/utils'

/**
 * Row detail. Base UI defaults for the sheet transition, unmodified — the motion
 * budget in docs/design.md spends nothing here.
 */
export function FeedDetailSheet({ row, onClose }: { row: FeedRow | null; onClose: () => void }) {
  const { amount, dateTime, clock } = useI18n()

  return (
    <Sheet open={row !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-md">
        {row ? (
          <>
            <SheetHeader>
              <SheetTitle className="amount text-display">
                {row.amountCents === null ? 'Unparsed message' : amount(row.amountCents)}
              </SheetTitle>
              <SheetDescription>
                Received {dateTime(row.receivedAt)} · server clock
              </SheetDescription>
            </SheetHeader>

            <div className="space-y-4 px-4 pb-6">
              <Field label="Status">
                <StatusLine row={row} />
              </Field>

              <Separator />

              <Field label="TrxID" mono>
                {row.trxId ?? '—'}
              </Field>
              <Field label="Reference" mono>
                {row.reference ?? '—'}
              </Field>
              <Field label="Sender" mono>
                {formatMsisdn(row.senderMsisdn)}
              </Field>

              <Separator />

              <Field label="Account">{row.accountLabel}</Field>
              <Field label="Provider">{row.accountProvider === 'bkash' ? 'bKash' : 'Nagad'}</Field>
              <Field label="Captured via">{row.source}</Field>
              <Field label="Transaction type">{row.transactionType ?? 'unknown'}</Field>
              <Field label="Parse status">
                <span
                  className={cn(
                    row.parseStatus === 'failed' && 'text-offline-subtle-foreground',
                    row.parseStatus === 'partial' && 'text-ambiguous-subtle-foreground',
                  )}
                >
                  {row.parseStatus}
                </span>
              </Field>

              <Separator />

              <Field label="Client reference">{row.intentReference ?? '—'}</Field>
              <Field label="Match confidence">{row.matchConfidence ?? '—'}</Field>

              <Separator />

              {/* occurred_at is stored for display only and is never used for
                  window logic — phone clocks drift. Labelled so nobody is
                  tempted to reason from it. */}
              <Field label="Message time">
                {row.occurredAt ? (
                  <span className="figure">
                    {clock(row.occurredAt)}{' '}
                    <span className="text-muted-foreground">— from the message, display only</span>
                  </span>
                ) : (
                  '—'
                )}
              </Field>
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  )
}

function StatusLine({ row }: { row: FeedRow }) {
  const tone: StatusTone =
    row.parseStatus === 'failed'
      ? 'offline'
      : row.status === 'matched'
        ? 'matched'
        : row.status === 'orphaned'
          ? 'ambiguous'
          : row.status === 'refunded'
            ? 'neutral'
            : 'pending'

  return (
    <span className="inline-flex items-center gap-1.5">
      <StatusDot tone={tone} />
      <span className={TONE_CLASSES[tone].text}>
        {row.parseStatus === 'failed' ? 'Parse failed' : row.status}
      </span>
    </span>
  )
}

function Field({
  label,
  children,
  mono = false,
}: {
  label: string
  children: React.ReactNode
  mono?: boolean
}) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className="shrink-0 text-small text-muted-foreground">{label}</span>
      <span className={cn('min-w-0 truncate text-right text-small', mono && 'figure')}>
        {children}
      </span>
    </div>
  )
}
