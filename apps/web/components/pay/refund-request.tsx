'use client'

import { useState, useTransition } from 'react'

/**
 * Asking the store for money back.
 *
 * Over-payment completes the order automatically, which is the right outcome —
 * the buyer paid enough and should not be held up. But it leaves them out of
 * pocket with no way to say so, and a debt nobody is chasing is one the buyer
 * ends up eating. This is the way to say so.
 *
 * It is careful about what it promises. Jomma cannot refund anything: it
 * watches the merchant's accounts and has no authority over them. So the copy
 * says the store has been told, never that money is coming back.
 */

const REASONS = [
  { value: 'overpaid' as const, label: 'I paid more than the amount due' },
  { value: 'cancel_order' as const, label: 'I want to cancel this order' },
  { value: 'other' as const, label: 'Something else' },
]

export function RefundRequest({
  intentId,
  merchant,
  excessCents,
  taka,
}: {
  intentId: string
  merchant: string
  excessCents: number
  taka: (poisha: number) => string
}) {
  const [reason, setReason] = useState<(typeof REASONS)[number]['value']>(
    excessCents > 0 ? 'overpaid' : 'cancel_order',
  )
  const [note, setNote] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  function submit() {
    setError(null)
    start(async () => {
      try {
        const response = await fetch(`/api/pay/${intentId}/refund`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ reason, note: note.trim() || null }),
        })
        const body = await response.json()

        if (!response.ok) {
          setError(body?.error?.message ?? 'Could not send that. Try again shortly.')
          return
        }

        setSent(true)
      } catch {
        setError('Could not reach us. Check your connection and try again.')
      }
    })
  }

  if (sent) {
    return (
      <div className="rounded-xl border border-border px-4 py-3 text-left">
        <p className="font-medium text-small">{merchant} has been told</p>
        {/* Careful not to promise a refund. Jomma cannot make one happen. */}
        <p className="mt-0.5 text-micro text-muted-foreground">
          They will contact you about it. Jomma does not hold your money — the store issues any
          refund from their own system.
        </p>
      </div>
    )
  }

  return (
    <details className="group rounded-xl border border-border text-left">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3">
        <span className="min-w-0">
          <span className="block font-medium text-small">
            {excessCents > 0 ? 'Ask about the extra you paid' : 'Ask for a refund'}
          </span>
          <span className="block text-micro text-muted-foreground">
            {excessCents > 0
              ? `You sent ${taka(excessCents)} more than the amount due`
              : `Contact ${merchant} about this payment`}
          </span>
        </span>
        <span
          className="shrink-0 text-muted-foreground text-small transition-transform group-open:rotate-180"
          aria-hidden="true"
        >
          ⌄
        </span>
      </summary>

      <div className="space-y-3 border-border/60 border-t px-4 py-3">
        <div className="space-y-1.5">
          {REASONS.map((option) => (
            <label
              key={option.value}
              className="flex cursor-pointer items-center gap-2.5 text-small"
            >
              <input
                type="radio"
                name="refund-reason"
                value={option.value}
                checked={reason === option.value}
                onChange={() => setReason(option.value)}
                className="size-3.5"
              />
              {option.label}
            </label>
          ))}
        </div>

        <textarea
          value={note}
          onChange={(event) => setNote(event.target.value)}
          rows={2}
          maxLength={500}
          placeholder="Anything the store should know (optional)"
          aria-label="Note for the store"
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-small"
        />

        {error ? <p className="text-micro text-ambiguous">{error}</p> : null}

        <button
          type="button"
          onClick={submit}
          disabled={pending}
          className="w-full rounded-lg border border-border py-2.5 text-small transition-colors hover:bg-accent disabled:opacity-60"
        >
          {pending ? 'Sending' : `Tell ${merchant}`}
        </button>
      </div>
    </details>
  )
}
