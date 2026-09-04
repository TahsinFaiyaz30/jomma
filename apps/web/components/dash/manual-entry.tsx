'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { manualEntryAction } from '@/app/(dash)/reconcile/actions'
import { StatusDot } from '@/components/status'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { Textarea } from '@/components/ui/textarea'
import { useI18n } from '@/lib/i18n/provider'
import type { ManualEntryResult } from '@/lib/services/manual-entry'

/**
 * Pasting a message in by hand.
 *
 * The path that still works when the phone is dead, the notifier is broken, the
 * provider changed its format, and the statement has not arrived. AGENTS.md
 * calls it *always available*, and that is the entire point of it existing.
 *
 * It runs the same pipeline as a device capture — same parser, same trx_id
 * dedupe, same matcher — so a payment recovered this way is indistinguishable
 * from one the notifier caught, apart from the audit trail naming who typed it.
 */
export function ManualEntry({
  accounts,
}: {
  accounts: Array<{ id: string; label: string; msisdn: string }>
}) {
  const { amount } = useI18n()
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? '')
  const [raw, setRaw] = useState('')
  const [pending, startTransition] = useTransition()
  const [result, setResult] = useState<ManualEntryResult | null>(null)

  if (accounts.length === 0) {
    return <p className="text-small text-muted-foreground">No receiving accounts configured.</p>
  }

  function submit() {
    startTransition(async () => {
      const response = await manualEntryAction(accountId, raw)
      if (response.ok) {
        toast.success(response.message)
        setResult(response.result ?? null)
        if (response.result?.status === 'accepted') setRaw('')
      } else {
        toast.error(response.message)
      }
    })
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
        <span className="text-micro text-muted-foreground">
          Which number the message arrived on
        </span>
      </div>

      <Textarea
        value={raw}
        onChange={(event) => setRaw(event.target.value)}
        placeholder="Paste the bKash message exactly as it appears, including the TrxID."
        rows={4}
        className="max-w-2xl font-mono text-small"
      />

      <div className="flex items-center gap-2">
        <Button size="sm" onClick={submit} disabled={pending || !raw.trim() || !accountId}>
          {pending ? <Spinner /> : null}
          Import message
        </Button>
        <span className="text-micro text-muted-foreground">
          Paste it verbatim — the raw text is stored before anything tries to read it.
        </span>
      </div>

      {result ? <Outcome result={result} amount={amount} /> : null}
    </div>
  )
}

function Outcome({
  result,
  amount,
}: {
  result: ManualEntryResult
  amount: (poisha: number) => string
}) {
  const tone =
    result.status === 'accepted'
      ? result.matched
        ? 'matched'
        : 'pending'
      : result.status === 'duplicate'
        ? 'neutral'
        : 'offline'

  const headline =
    result.status === 'duplicate'
      ? 'Already known'
      : result.status === 'unparsed'
        ? 'Stored, but could not be read'
        : result.matched
          ? 'Imported and matched'
          : 'Imported — nothing claims it yet'

  const detail =
    result.status === 'duplicate'
      ? `${result.trxId ?? 'That TrxID'} was already captured. Nothing was duplicated.`
      : result.status === 'unparsed'
        ? `${result.parseError ?? 'The parser could not read it.'} The raw text is saved and is in the queue for a human.`
        : result.matched
          ? `${result.trxId} applied to an intent.`
          : `${result.trxId} is in the queue — no open intent matches it.`

  return (
    <div className="flex max-w-2xl items-start gap-3 rounded-lg border border-border bg-card p-3">
      <StatusDot tone={tone} className="mt-1.5" />
      <div className="min-w-0 space-y-0.5">
        <div className="flex items-baseline gap-3">
          <span className="text-small font-medium">{headline}</span>
          {result.amountCents !== null ? (
            <span className="amount text-small">{amount(result.amountCents)}</span>
          ) : null}
        </div>
        <p className="text-micro text-muted-foreground">{detail}</p>
      </div>
    </div>
  )
}
