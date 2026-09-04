'use client'

import type { Provider } from '@jomma/shared'
import { useState, useTransition } from 'react'
import type { CheckoutMethod } from '@/lib/services/checkout'

/**
 * How would you like to pay?
 *
 * Unavailable methods are shown greyed with a reason rather than hidden. A
 * checkout that lists one option leaves the buyer wondering whether the other
 * exists and whether they are on the right page; "Nagad — not available yet" is
 * a worse offer but a better answer.
 *
 * Bank transfer and card are listed the same way, because they are the two
 * things people ask for first and their absence should be a stated fact rather
 * than a gap.
 */

const BRAND: Record<Provider, { tint: string; mark: string }> = {
  bkash: { tint: '#e2136e', mark: 'b' },
  nagad: { tint: '#ee1c25', mark: 'N' },
}

const FUTURE = [
  { label: 'Bank transfer', reason: 'Not supported yet' },
  { label: 'Card', reason: 'Not supported yet' },
]

export function MethodPicker({
  methods,
  intentId,
  canSwitch,
  onSwitched,
}: {
  methods: CheckoutMethod[]
  intentId: string
  /** False once money has arrived — the receiving account is pinned from then. */
  canSwitch: boolean
  onSwitched: (methods: CheckoutMethod[], provider: Provider) => void
}) {
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  function choose(provider: Provider) {
    setError(null)
    start(async () => {
      try {
        const response = await fetch(`/api/pay/${intentId}/method`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ provider }),
        })
        const body = await response.json()

        if (!response.ok) {
          setError(body?.error?.message ?? 'That method is not available right now.')
          return
        }

        onSwitched(body.methods as CheckoutMethod[], provider)
      } catch {
        setError('Could not reach us. Check your connection and try again.')
      }
    })
  }

  return (
    <div className="space-y-3">
      <h2 className="font-medium text-title">How would you like to pay?</h2>

      <div className="space-y-2">
        {methods.map((method) => {
          const brand = BRAND[method.provider]
          const selectable = method.available && !method.selected && canSwitch

          return (
            <button
              key={method.provider}
              type="button"
              disabled={!selectable || pending}
              onClick={() => choose(method.provider)}
              aria-current={method.selected}
              className={`flex w-full items-center gap-3 rounded-xl border px-4 py-3.5 text-left transition-colors ${
                method.selected
                  ? 'border-primary bg-accent'
                  : method.available && canSwitch
                    ? 'border-border hover:bg-accent'
                    : 'cursor-not-allowed border-border/60 opacity-55'
              }`}
            >
              <span
                className="flex size-9 shrink-0 items-center justify-center rounded-lg font-semibold text-white"
                style={{ backgroundColor: brand.tint }}
                aria-hidden="true"
              >
                {brand.mark}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-medium text-small">{method.label}</span>
                {method.reason ? (
                  <span className="block text-micro text-muted-foreground">{method.reason}</span>
                ) : null}
              </span>
              {method.selected ? (
                <span className="shrink-0 text-micro text-muted-foreground">Selected</span>
              ) : null}
            </button>
          )
        })}

        {FUTURE.map((item) => (
          <div
            key={item.label}
            className="flex w-full items-center gap-3 rounded-xl border border-border/60 px-4 py-3.5 opacity-55"
          >
            <span
              className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted"
              aria-hidden="true"
            />
            <span className="min-w-0 flex-1">
              <span className="block font-medium text-small">{item.label}</span>
              <span className="block text-micro text-muted-foreground">{item.reason}</span>
            </span>
          </div>
        ))}
      </div>

      {error ? <p className="text-micro text-ambiguous">{error}</p> : null}

      {!canSwitch ? (
        <p className="text-micro text-muted-foreground">
          Part of this payment has already arrived, so it has to be finished on the same method.
        </p>
      ) : null}
    </div>
  )
}
