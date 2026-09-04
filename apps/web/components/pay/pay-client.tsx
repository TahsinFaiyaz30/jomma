'use client'

import { useCallback, useEffect, useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { PayView } from '@/lib/services/pay-page'
import { BkashGuide } from './guide'

/**
 * The buyer's page.
 *
 * Three states, in the order they happen: ask who is paying, walk them through
 * it, then tell them it landed. The middle one is the guide; the other two are
 * deliberately plain, because the only thing that matters in them is one fact.
 */

/** ৳ with two decimals. Local, so the public page carries no dashboard i18n. */
function taka(poisha: number): string {
  return `৳${(poisha / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

function useCountdown(expiresAt: string): string {
  const [left, setLeft] = useState(() => Date.parse(expiresAt) - Date.now())

  useEffect(() => {
    const timer = setInterval(() => setLeft(Date.parse(expiresAt) - Date.now()), 1000)
    return () => clearInterval(timer)
  }, [expiresAt])

  if (left <= 0) return '0:00'
  const total = Math.floor(left / 1000)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

function CopyRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false)

  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5">
      <div className="min-w-0">
        <p className="text-micro text-muted-foreground">{label}</p>
        <p className="figure truncate font-semibold text-title">{value}</p>
      </div>
      <button
        type="button"
        onClick={() => {
          void navigator.clipboard.writeText(value).then(() => {
            setCopied(true)
            setTimeout(() => setCopied(false), 1500)
          })
        }}
        className="shrink-0 rounded-md border border-border px-2.5 py-1 text-micro hover:bg-accent"
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  )
}

export function PayClient({ initial }: { initial: PayView }) {
  const [view, setView] = useState(initial)
  const [buyerMsisdn, setBuyerMsisdn] = useState('')
  const [started, setStarted] = useState(false)
  const [guideOpen, setGuideOpen] = useState(false)
  const countdown = useCountdown(view.expiresAt)

  /*
   * Poll while it is still worth polling. The phone usually captures the message
   * within a few seconds, so this is what turns the page from instructions into
   * a receipt without the buyer touching anything.
   */
  useEffect(() => {
    if (view.status !== 'open' && view.status !== 'partial') return

    const timer = setInterval(async () => {
      try {
        const response = await fetch(`/api/pay/${view.id}/status`, { cache: 'no-store' })
        if (!response.ok) return
        const next = (await response.json()) as {
          status: PayView['status']
          received_amount: number
          shortfall: number
        }
        setView((current) => ({
          ...current,
          status: next.status,
          receivedAmountCents: next.received_amount,
          shortfallCents: next.shortfall,
        }))
      } catch {
        // A dropped poll is not worth surfacing; the next tick retries.
      }
    }, 2500)

    return () => clearInterval(timer)
  }, [view.id, view.status])

  const begin = useCallback(() => {
    setStarted(true)
    const digits = buyerMsisdn.replace(/\D/g, '')
    if (digits.length < 11) return

    // Best effort. The guide must start whether or not this lands.
    void fetch(`/api/pay/${view.id}/payer`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ msisdn: digits }),
    }).catch(() => {})
  }, [buyerMsisdn, view.id])

  /* ── Done ───────────────────────────────────────────────────────────────── */

  if (view.status === 'matched') {
    return (
      <Shell merchant={view.merchantName}>
        <div className="space-y-4 text-center">
          <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-matched-subtle">
            <span className="text-matched-subtle-foreground text-title">✓</span>
          </div>
          <div>
            <h1 className="font-medium text-display">Payment received</h1>
            <p className="mt-1 text-small text-muted-foreground">
              {taka(view.amountCents)} confirmed. You can close this page.
            </p>
          </div>
          {view.returnUrl ? (
            <a
              href={view.returnUrl}
              className="inline-block rounded-md bg-primary px-4 py-2 text-primary-foreground text-small"
            >
              Return to {view.merchantName}
            </a>
          ) : null}
        </div>
      </Shell>
    )
  }

  if (view.status === 'expired' || view.status === 'cancelled') {
    return (
      <Shell merchant={view.merchantName}>
        <div className="space-y-3 text-center">
          <h1 className="font-medium text-display">
            {view.status === 'expired' ? 'This payment expired' : 'This payment was cancelled'}
          </h1>
          <p className="text-small text-muted-foreground">
            {view.status === 'expired'
              ? 'Go back and start checkout again to get a fresh reference code.'
              : 'The store cancelled this order.'}
          </p>
          <p className="text-micro text-muted-foreground">
            If you already sent the money, do not send it again — contact {view.merchantName}.
          </p>
          {view.cancelUrl ? (
            <a href={view.cancelUrl} className="inline-block text-small underline">
              Back to {view.merchantName}
            </a>
          ) : null}
        </div>
      </Shell>
    )
  }

  /* ── Who is paying ──────────────────────────────────────────────────────── */

  if (!started) {
    return (
      <Shell merchant={view.merchantName}>
        <div className="space-y-4">
          <div>
            <h1 className="font-medium text-display">Pay {taka(view.amountCents)}</h1>
            <p className="mt-1 text-small text-muted-foreground">
              Which bKash number will you send from? It helps us match your payment faster.
            </p>
          </div>

          <input
            inputMode="numeric"
            autoComplete="tel"
            value={buyerMsisdn}
            onChange={(event) => setBuyerMsisdn(event.target.value)}
            placeholder="01XXXXXXXXX"
            aria-label="Your bKash number"
            className="figure w-full rounded-md border border-border bg-background px-3 py-2.5 text-title"
          />

          <button
            type="button"
            onClick={begin}
            className="w-full rounded-md bg-primary py-2.5 font-medium text-primary-foreground text-small"
          >
            Show me how to pay
          </button>

          <button
            type="button"
            onClick={() => setStarted(true)}
            className="w-full text-micro text-muted-foreground underline-offset-2 hover:underline"
          >
            Skip — I'll just follow the steps
          </button>
        </div>
      </Shell>
    )
  }

  /* ── The walkthrough ────────────────────────────────────────────────────── */

  const buyerDigits = buyerMsisdn.replace(/\D/g, '')
  const guide = {
    msisdn: view.receivingMsisdn,
    amount: taka(view.shortfallCents),
    refCode: view.refCode ?? '',
    buyerLabel: buyerDigits.length >= 11 ? buyerDigits : 'You',
  }

  const details = (
    <div className="space-y-5">
      <div className="flex items-baseline justify-between gap-3">
        <h1 className="amount font-semibold text-display">{taka(view.shortfallCents)}</h1>
        <span className="figure text-small text-muted-foreground">{countdown} left</span>
      </div>

      {view.status === 'partial' ? (
        <p className="rounded-lg bg-pending-subtle px-3 py-2 text-pending-subtle-foreground text-small">
          {taka(view.receivedAmountCents)} received so far. Send the remaining{' '}
          {taka(view.shortfallCents)} using the same reference.
        </p>
      ) : null}

      <div className="space-y-2">
        <CopyRow label="Send to" value={view.receivingMsisdn} />
        <CopyRow label="Amount" value={(view.shortfallCents / 100).toFixed(2)} />
        {view.refCode ? <CopyRow label="Reference" value={view.refCode} /> : null}
      </div>

      {/* Narrow screens do not get the guide inline — a 577px phone mock under
          the details means scrolling past the numbers to reach it and back up to
          copy them. It opens over the top instead. */}
      <button
        type="button"
        onClick={() => setGuideOpen(true)}
        className="w-full rounded-md border border-border py-2.5 text-small md:hidden"
      >
        Show me how to pay
      </button>

      <p className="flex items-center justify-center gap-2 text-center text-micro text-muted-foreground">
        <span className="inline-block size-1.5 animate-pulse rounded-full bg-pending" />
        Waiting for your payment. This page updates by itself.
      </p>
    </div>
  )

  return (
    <>
      <main className="mx-auto flex min-h-svh w-full max-w-4xl flex-col justify-center px-5 py-8">
        <p className="mb-5 text-center text-micro text-muted-foreground md:text-left">
          {view.merchantName}
        </p>

        {/* Side by side once there is room for both; the mock is a fixed 280px,
            so anything narrower would squeeze the details rather than share. */}
        <div className="flex flex-col gap-8 md:flex-row md:items-start md:gap-10">
          <div className="mx-auto w-full max-w-sm md:mx-0 md:flex-1">{details}</div>
          <div className="hidden md:block">
            <BkashGuide data={guide} />
          </div>
        </div>

        <p className="mt-8 text-center text-micro text-muted-foreground md:text-left">
          Verified by Jomma. We never ask for your PIN.
        </p>
      </main>

      <Dialog open={guideOpen} onOpenChange={setGuideOpen}>
        <DialogContent className="max-h-[92svh] overflow-auto p-4 sm:max-w-md">
          <DialogHeader className="sr-only">
            <DialogTitle>How to pay with bKash</DialogTitle>
          </DialogHeader>
          <BkashGuide data={guide} />
        </DialogContent>
      </Dialog>
    </>
  )
}

function Shell({ merchant, children }: { merchant: string; children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-svh w-full max-w-md flex-col justify-center px-5 py-8">
      <p className="mb-5 text-center text-micro text-muted-foreground">{merchant}</p>
      {children}
      <p className="mt-8 text-center text-micro text-muted-foreground">
        Verified by Jomma. We never ask for your PIN.
      </p>
    </main>
  )
}
