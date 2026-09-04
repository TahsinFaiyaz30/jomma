'use client'

import { useState, useTransition } from 'react'

/**
 * "I've already sent it" — the buyer proving a payment with its TrxID.
 *
 * The fallback for when automatic matching has not happened: the merchant's
 * phone might be off, the message might have arrived in a shape the parser
 * could not read, or the buyer might simply not want to wait. The TrxID is
 * strong evidence on its own — it is provider-generated, and the only way to
 * know one is to have made the payment.
 *
 * The server returns one of nine resolutions and the numbers behind it. This
 * component's whole job is turning those into a sentence that tells the buyer
 * what to do next, which is the part a resolution string does not do.
 */

export interface SubmitOutcome {
  resolution: string
  intent_status?: string
  received_amount?: number
  shortfall?: number
  excess?: number
  top_up?: { amount: number; ref_code: string | null; receiving_msisdn: string } | null
}

type Tone = 'good' | 'wait' | 'bad'

function describe(
  outcome: SubmitOutcome,
  taka: (poisha: number) => string,
): { tone: Tone; title: string; detail: string } {
  switch (outcome.resolution) {
    case 'exact':
    case 'sender_mismatch':
      // A mismatched sender is approved and flagged for the merchant. It is not
      // the buyer's problem to solve and telling them would only alarm them.
      return {
        tone: 'good',
        title: 'Payment confirmed',
        detail: 'Thank you. You can close this page.',
      }

    case 'overpaid':
      return {
        tone: 'good',
        title: 'Payment confirmed',
        detail: outcome.excess
          ? `You sent ${taka(outcome.excess)} more than the amount due. Contact the store about the difference.`
          : 'Thank you. You can close this page.',
      }

    case 'underpaid':
      return {
        tone: 'wait',
        title: `Counted ${taka(outcome.received_amount ?? 0)}`,
        detail: outcome.top_up
          ? `Send the remaining ${taka(outcome.top_up.amount)} to ${outcome.top_up.receiving_msisdn}${
              outcome.top_up.ref_code ? ` with the same reference ${outcome.top_up.ref_code}` : ''
            }.`
          : 'Send the remaining amount using the same reference.',
      }

    case 'not_found_recent':
      return {
        tone: 'wait',
        title: 'Not seen yet',
        detail:
          'Payments usually appear within a minute. Leave this page open — we are still watching and it will confirm by itself.',
      }

    case 'not_found_stale':
      return {
        tone: 'bad',
        title: 'We cannot find that transaction',
        detail:
          'Check the TrxID in your message and try again. We are still watching for it either way — the store has been notified.',
      }

    case 'already_used':
      return {
        tone: 'bad',
        title: 'That transaction is already used',
        detail: 'It was counted against a different order. Contact the store if that seems wrong.',
      }

    case 'wrong_type':
      return {
        tone: 'wait',
        title: 'Being checked by hand',
        detail:
          'We found the payment but it needs a person to confirm it. The store has been notified.',
      }

    case 'expired_intent':
      return {
        tone: 'wait',
        title: 'This order had already expired',
        detail:
          'Your money arrived and is not lost. The store has been notified and will sort it out.',
      }

    default:
      return {
        tone: 'wait',
        title: 'Submitted',
        detail: 'The store has been notified.',
      }
  }
}

const TONE_CLASS: Record<Tone, string> = {
  good: 'border-matched/40 bg-matched-subtle text-matched-subtle-foreground',
  wait: 'border-pending/40 bg-pending-subtle text-pending-subtle-foreground',
  bad: 'border-ambiguous/40 bg-ambiguous-subtle text-ambiguous-subtle-foreground',
}

export function TrxVerify({
  intentId,
  taka,
  onResolved,
}: {
  intentId: string
  taka: (poisha: number) => string
  /** Lets the page refresh its totals as soon as something is applied. */
  onResolved: () => void
}) {
  const [open, setOpen] = useState(false)
  const [trxId, setTrxId] = useState('')
  const [outcome, setOutcome] = useState<SubmitOutcome | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  function submit() {
    const value = trxId.trim().toUpperCase()
    if (value.length < 6) {
      setError('A TrxID is at least 6 characters.')
      return
    }

    setError(null)
    start(async () => {
      try {
        const response = await fetch(`/api/pay/${intentId}/submit`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ trx_id: value }),
        })
        const body = await response.json()

        if (!response.ok) {
          setError(body?.error?.message ?? 'Could not check that right now. Try again shortly.')
          return
        }

        setOutcome(body as SubmitOutcome)
        onResolved()
      } catch {
        setError('Could not reach us. Check your connection and try again.')
      }
    })
  }

  const described = outcome ? describe(outcome, taka) : null

  /*
   * Folded away, and named as the manual path.
   *
   * The automatic check is the product and it is already running; this is the
   * fallback for when it is slow. Left open by default it reads as the thing
   * the buyer is supposed to do, which is both wrong and more work for them.
   * `details`/`summary` rather than a state-driven panel so it opens even if
   * hydration has not finished.
   */
  return (
    <details
      className="group rounded-xl border border-border"
      open={open}
      onToggle={(event) => setOpen((event.currentTarget as HTMLDetailsElement).open)}
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3">
        <span className="min-w-0">
          <span className="block font-medium text-small">Verify manually</span>
          <span className="block text-micro text-muted-foreground">
            Only if the automatic check is taking too long
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
        <p className="text-micro text-muted-foreground">
          Enter the TrxID from the confirmation message on your phone — ten characters, like{' '}
          <span className="figure">9F2K1LM8QR</span>. We keep checking automatically either way.
        </p>

        <div className="flex gap-2">
          <input
            value={trxId}
            onChange={(event) => setTrxId(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') submit()
            }}
            placeholder="TrxID"
            aria-label="Your TrxID"
            autoCapitalize="characters"
            spellCheck={false}
            className="figure min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-2.5 text-small uppercase"
          />
          <button
            type="button"
            onClick={submit}
            disabled={pending}
            className="shrink-0 rounded-lg bg-primary px-4 py-2.5 font-medium text-primary-foreground text-small disabled:opacity-60"
          >
            {pending ? 'Checking' : 'Check'}
          </button>
        </div>

        {error ? <p className="text-micro text-ambiguous">{error}</p> : null}

        {described ? (
          <div className={`rounded-lg border px-3 py-2.5 ${TONE_CLASS[described.tone]}`}>
            <p className="font-medium text-small">{described.title}</p>
            <p className="mt-0.5 text-micro opacity-90">{described.detail}</p>
          </div>
        ) : null}
      </div>
    </details>
  )
}
