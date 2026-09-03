'use client'

import { useMemo, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { reverseMatchAction } from '@/app/(dash)/intents/actions'
import { StatusDot } from '@/components/status'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
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
import type { IntentDetail, IntentRow } from '@/lib/services/intent-admin'
import { INTENT_STATUS_META, TONE_CLASSES } from '@/lib/status'
import { cn } from '@/lib/utils'

export function IntentsView({
  intents,
  accounts,
  detailFor,
}: {
  intents: IntentRow[]
  accounts: Array<{ id: string; label: string }>
  detailFor: (id: string) => Promise<IntentDetail | null>
}) {
  const { amount, clock, elapsed } = useI18n()
  const [status, setStatus] = useState<string>('all')
  const [accountId, setAccountId] = useState<string>('all')
  const [search, setSearch] = useState('')
  const [detail, setDetail] = useState<IntentDetail | null>(null)
  const [loadingDetail, startDetail] = useTransition()

  // Filtering happens client-side over the already-loaded page. The server query
  // supports the same filters for when this outgrows one page.
  const filtered = useMemo(() => {
    const needle = search.trim().toUpperCase()
    return intents.filter((intent) => {
      if (status !== 'all' && intent.status !== status) return false
      if (accountId !== 'all' && !intent.accountLabel) return false
      if (
        needle &&
        ![intent.clientReference, intent.refCode, intent.payerMsisdn, intent.publicId]
          .filter(Boolean)
          .some((field) => (field as string).toUpperCase().includes(needle))
      ) {
        return false
      }
      return true
    })
  }, [intents, status, accountId, search])

  function open(intent: IntentRow) {
    startDetail(async () => {
      const result = await detailFor(intent.id)
      setDetail(result)
    })
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-border border-b px-3 py-2">
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Client reference, code, or number"
          className="h-7 max-w-64 text-small"
        />
        <select
          value={status}
          onChange={(event) => setStatus(event.target.value)}
          className="h-7 rounded-md border border-border bg-background px-2 text-small"
        >
          {['all', 'open', 'matched', 'partial', 'over', 'expired', 'cancelled'].map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
        <select
          value={accountId}
          onChange={(event) => setAccountId(event.target.value)}
          className="h-7 rounded-md border border-border bg-background px-2 text-small"
        >
          <option value="all">all accounts</option>
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.label}
            </option>
          ))}
        </select>
        <span className="ml-auto text-micro text-muted-foreground">{filtered.length} shown</span>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <div className="sticky top-0 z-10 flex h-8 items-center border-border border-b bg-background/95 px-3 text-micro text-muted-foreground backdrop-blur">
          <span className="w-[72px]">Created</span>
          <span className="w-[104px] text-right">Amount</span>
          <span className="w-[104px] pl-4 text-right">Received</span>
          <span className="w-[64px] pl-4">Code</span>
          <span className="min-w-0 flex-1 pl-4">Client reference</span>
          <span className="w-[112px] pl-4">Status</span>
          <span className="hidden w-[96px] pl-4 lg:block">Expires</span>
        </div>

        {filtered.length === 0 ? (
          <p className="px-6 py-16 text-center text-small text-muted-foreground">
            No intents match those filters.
          </p>
        ) : (
          filtered.map((intent) => {
            const meta = INTENT_STATUS_META[intent.status]
            return (
              <button
                type="button"
                key={intent.id}
                onClick={() => open(intent)}
                className="flex h-row w-full items-center border-border/50 border-b px-3 text-left hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
              >
                <span className="figure w-[72px] text-micro text-muted-foreground">
                  {clock(intent.createdAt)}
                </span>
                <span className="amount w-[104px] text-right text-small">
                  {amount(intent.amountCents)}
                </span>
                <span
                  className={cn(
                    'amount w-[104px] pl-4 text-right text-small',
                    intent.receivedAmountCents === 0 && 'text-muted-foreground',
                  )}
                >
                  {amount(intent.receivedAmountCents)}
                </span>
                <span className="figure w-[64px] pl-4 text-small">{intent.refCode ?? '—'}</span>
                <span className="min-w-0 flex-1 truncate pl-4 text-small">
                  {intent.clientReference}
                </span>
                <span className="flex w-[112px] items-center gap-1.5 pl-4">
                  <StatusDot tone={meta.tone} />
                  <span className={cn('text-small', TONE_CLASSES[meta.tone].text)}>
                    {intent.status}
                  </span>
                </span>
                <span className="hidden w-[96px] pl-4 text-micro text-muted-foreground lg:block">
                  {intent.status === 'open' ? elapsed(intent.expiresAt) : '—'}
                </span>
              </button>
            )
          })
        )}
      </div>

      <IntentSheet
        detail={detail}
        loading={loadingDetail}
        onClose={() => setDetail(null)}
        formatAmount={amount}
      />
    </div>
  )
}

function IntentSheet({
  detail,
  loading,
  onClose,
  formatAmount,
}: {
  detail: IntentDetail | null
  loading: boolean
  onClose: () => void
  formatAmount: (poisha: number) => string
}) {
  const { dateTime } = useI18n()
  const [confirming, setConfirming] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  return (
    <Sheet open={detail !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-lg">
        {loading || !detail ? (
          <div className="p-6 text-small text-muted-foreground">Loading…</div>
        ) : (
          <>
            <SheetHeader>
              <SheetTitle className="amount text-display">
                {formatAmount(detail.amountCents)}
              </SheetTitle>
              <SheetDescription>
                {detail.clientReference} · {detail.appName}
              </SheetDescription>
            </SheetHeader>

            <div className="space-y-4 overflow-y-auto px-4 pb-6">
              <div className="grid grid-cols-2 gap-2 text-small">
                <Field label="Status" value={detail.status} />
                <Field label="Received" value={formatAmount(detail.receivedAmountCents)} />
                <Field label="Reference" value={detail.refCode ?? '—'} mono />
                <Field label="Intent id" value={detail.publicId} mono />
                <Field label="Account" value={detail.accountLabel} />
                <Field label="Expected payer" value={formatMsisdn(detail.payerMsisdn)} mono />
              </div>

              {detail.payments.length > 0 ? (
                <>
                  <Separator />
                  <div className="space-y-2">
                    <div className="text-small font-medium">Applied payments</div>
                    {detail.payments.map((payment) => (
                      <div
                        key={`${payment.trxId}-${payment.appliedAt}`}
                        className={cn(
                          'rounded-md border border-border px-3 py-2',
                          payment.reversedAt && 'opacity-60',
                        )}
                      >
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="figure text-small">{payment.trxId ?? '—'}</span>
                          <span className="amount text-small">
                            {formatAmount(payment.appliedCents)}
                          </span>
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-2 text-micro text-muted-foreground">
                          <span>{payment.confidence}</span>
                          <span>by {payment.matchedBy}</span>
                          {payment.score !== null ? <span>score {payment.score}</span> : null}
                          <span>{dateTime(payment.appliedAt)}</span>
                          {payment.reversedAt ? (
                            <span className="text-offline-subtle-foreground">reversed</span>
                          ) : null}
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              ) : null}

              {detail.submissions.length > 0 ? (
                <>
                  <Separator />
                  <div className="space-y-1">
                    <div className="text-small font-medium">Buyer submissions</div>
                    {detail.submissions.map((submission) => (
                      <div
                        key={`${submission.trxId}-${submission.createdAt}`}
                        className="flex items-baseline justify-between gap-2 text-small"
                      >
                        <span className="figure">{submission.trxId}</span>
                        <span className="text-muted-foreground">{submission.resolution}</span>
                      </div>
                    ))}
                  </div>
                </>
              ) : null}

              <Separator />

              {/*
                The audit trail, verbatim. This is the record that makes a
                reversal defensible: what was seen, what scored what, and who
                decided.
              */}
              <div className="space-y-2">
                <div className="text-small font-medium">Timeline</div>
                {detail.timeline.length === 0 ? (
                  <p className="text-small text-muted-foreground">Nothing recorded.</p>
                ) : (
                  <ol className="space-y-2">
                    {detail.timeline.map((entry) => (
                      <li key={entry.id} className="border-border/60 border-l-2 pl-3">
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="figure text-small">{entry.action}</span>
                          <span className="text-micro text-muted-foreground">
                            {dateTime(entry.createdAt)}
                          </span>
                        </div>
                        <div className="text-micro text-muted-foreground">
                          by {entry.actorType}
                          {entry.requestId ? ` · ${entry.requestId}` : ''}
                        </div>
                        {Object.keys(entry.payload).length > 0 ? (
                          <pre className="mt-1 overflow-x-auto whitespace-pre-wrap rounded bg-muted px-2 py-1 text-micro text-muted-foreground">
                            {JSON.stringify(entry.payload, null, 1)}
                          </pre>
                        ) : null}
                      </li>
                    ))}
                  </ol>
                )}
              </div>

              {detail.payments.some((p) => !p.reversedAt) ? (
                <>
                  <Separator />
                  <Button
                    variant="destructive"
                    size="sm"
                    disabled={pending}
                    onClick={() => setConfirming(detail.id)}
                  >
                    Reverse match
                  </Button>
                </>
              ) : null}
            </div>

            <AlertDialog open={confirming !== null} onOpenChange={(o) => !o && setConfirming(null)}>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Reverse this match?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Jomma already told {detail.appName} this money arrived. Reversing sends a
                    payment.reversed webhook, and the client has to be able to un-fulfil the order.
                    The payment goes back to unmatched — nothing is deleted.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() =>
                      startTransition(async () => {
                        const result = await reverseMatchAction(
                          detail.id,
                          'Reversed from dashboard',
                        )
                        if (result.ok) {
                          toast.success(result.message)
                          onClose()
                        } else {
                          toast.error(result.message)
                        }
                        setConfirming(null)
                      })
                    }
                  >
                    Reverse
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}

function Field({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="text-micro text-muted-foreground">{label}</div>
      <div className={cn('truncate', mono && 'figure')}>{value}</div>
    </div>
  )
}
