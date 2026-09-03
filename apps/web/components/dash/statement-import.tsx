'use client'

import { useRef, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { importStatementAction } from '@/app/(dash)/reconcile/actions'
import { Spinner } from '@/components/ui/spinner'
import { useI18n } from '@/lib/i18n/provider'
import type { ImportResult } from '@/lib/services/statement-import'

/**
 * Weekly statement import — the safety net under the notifier.
 *
 * The number that matters is `recovered`: rows the unique index on trx_id did
 * not already know about. Everything else being a duplicate is the good outcome.
 */
export function StatementImport({
  accounts,
}: {
  accounts: Array<{ id: string; label: string; msisdn: string }>
}) {
  const { amount, dateTime } = useI18n()
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? '')
  const [pending, startTransition] = useTransition()
  const [result, setResult] = useState<ImportResult | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  function onFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file || !accountId) return

    startTransition(async () => {
      const csv = await file.text()
      const response = await importStatementAction(accountId, csv)
      if (response.ok) {
        toast.success(response.message)
        setResult(response.result ?? null)
      } else {
        toast.error(response.message)
      }
      if (fileRef.current) fileRef.current.value = ''
    })
  }

  if (accounts.length === 0) {
    return <p className="text-small text-muted-foreground">No receiving accounts configured.</p>
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={accountId}
          onChange={(event) => setAccountId(event.target.value)}
          className="h-7 rounded-md border border-border bg-background px-2 text-small"
        >
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.label}
            </option>
          ))}
        </select>

        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          onChange={onFile}
          disabled={pending || !accountId}
          className="block text-small file:mr-2 file:rounded-md file:border file:border-border file:bg-card file:px-2 file:py-1 file:text-small file:text-foreground hover:file:bg-accent"
        />
        {pending ? <Spinner /> : null}
      </div>

      <p className="max-w-2xl text-small text-muted-foreground">
        Rows are matched exactly like a live capture, so a payment missed three days ago still finds
        its intent. Anything already captured collides on <span className="figure">trx_id</span> and
        is absorbed silently.
      </p>

      {result ? (
        <div className="space-y-3 rounded-lg border border-border bg-card p-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Rows read" value={String(result.parsed)} />
            <Stat label="Already known" value={String(result.duplicates)} />
            <Stat
              label="Never seen"
              value={String(result.recovered)}
              // Non-zero means the notifier missed money. That is the alarm.
              tone={result.recovered > 0 ? 'offline' : 'matched'}
            />
            <Stat label="Auto-matched" value={String(result.matched)} />
          </div>

          {result.recoveredRows.length > 0 ? (
            <div className="space-y-1">
              <div className="text-small font-medium text-offline-subtle-foreground">
                Payments the notifier never saw
              </div>
              {result.recoveredRows.slice(0, 20).map((row) => (
                <div
                  key={row.trxId}
                  className="flex items-baseline justify-between gap-3 text-small"
                >
                  <span className="figure">{row.trxId}</span>
                  <span className="amount">
                    {row.amountCents === null ? '—' : amount(row.amountCents)}
                  </span>
                  <span className="text-micro text-muted-foreground">
                    {row.occurredAt ? dateTime(row.occurredAt) : '—'}
                  </span>
                </div>
              ))}
              <p className="pt-1 text-micro text-muted-foreground">
                These are in the queue now. Work out why the notifier missed them.
              </p>
            </div>
          ) : null}

          {result.errors.length > 0 ? (
            <div className="space-y-0.5">
              <div className="text-small font-medium">Skipped rows</div>
              {result.errors.slice(0, 10).map((error) => (
                <p key={error} className="text-micro text-ambiguous-subtle-foreground">
                  {error}
                </p>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function Stat({
  label,
  value,
  tone = 'neutral',
}: {
  label: string
  value: string
  tone?: 'neutral' | 'matched' | 'offline'
}) {
  return (
    <div>
      <div className="text-micro text-muted-foreground">{label}</div>
      <div
        className={
          tone === 'offline'
            ? 'amount text-title text-offline-subtle-foreground'
            : tone === 'matched'
              ? 'amount text-title text-matched-subtle-foreground'
              : 'amount text-title'
        }
      >
        {value}
      </div>
    </div>
  )
}
