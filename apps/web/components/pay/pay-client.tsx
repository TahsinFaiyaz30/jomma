'use client'

import type { Provider } from '@jomma/shared'
import { useCallback, useEffect, useState } from 'react'
import { ThemeSegmented } from '@/components/theme-toggle'
import type { CheckoutMethod } from '@/lib/services/checkout'
import type { PayView } from '@/lib/services/pay-page'
import { hasGuide, ProviderGuide } from './guides'
import { MethodPicker } from './method-picker'
import { TrxVerify } from './trx-verify'

/**
 * The buyer's page.
 *
 * A short queue of decisions, in the order they actually happen: how are you
 * paying, which number from, then the instructions and the walkthrough, then
 * the receipt. Each step asks one question, because the buyer is standing in a
 * checkout with their phone in the other hand.
 *
 * More generously spaced than the dashboard on purpose. docs/design.md picks
 * Mira for dense admin screens and names Luma for onboarding and checkout —
 * this is the checkout, so it takes the softer radii and the bigger rhythm
 * while still using the same tokens.
 */

/**
 * How long automatic matching gets before the manual box is offered.
 *
 * Captures usually land in seconds. This is generous on purpose — the cost of
 * showing the form too early is a buyer typing a TrxID for a payment that was
 * about to confirm itself, and reading `not_found` as bad news.
 */
const AUTO_MATCH_GRACE_MS = 40_000

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

/* ── Shared chrome ────────────────────────────────────────────────────────── */

function Shell({
  merchant,
  children,
  wide = false,
}: {
  merchant: string
  children: React.ReactNode
  wide?: boolean
}) {
  return (
    <main
      className={`mx-auto flex min-h-svh w-full flex-col px-5 py-8 ${
        wide ? 'max-w-4xl justify-start md:justify-center' : 'max-w-md justify-center'
      }`}
    >
      <div className="mb-6 flex items-center justify-between gap-3">
        <p className="truncate text-micro text-muted-foreground">{merchant}</p>
        {/* The buyer is not the admin whose theme cookie this is. Giving them
            their own control costs one component and stops the page being
            whatever the last person on this browser preferred. */}
        <ThemeSegmented />
      </div>

      {children}

      <p className="mt-10 text-center text-micro text-muted-foreground">
        Verified by Jomma. We never ask for your PIN.
      </p>
    </main>
  )
}

function CopyRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false)

  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-border px-4 py-3">
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
        className="shrink-0 rounded-lg border border-border px-3 py-1.5 text-micro transition-colors hover:bg-accent"
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  )
}

/* ── Terminal states ──────────────────────────────────────────────────────── */

function Receipt({ view }: { view: PayView }) {
  return (
    <Shell merchant={view.merchantName}>
      <div className="space-y-5 text-center">
        <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-matched-subtle">
          <span className="text-display text-matched-subtle-foreground">✓</span>
        </div>
        <div>
          <h1 className="font-medium text-display">Payment received</h1>
          <p className="mt-1.5 text-small text-muted-foreground">
            {taka(view.receivedAmountCents || view.amountCents)} confirmed.
          </p>
          {view.excessCents > 0 ? (
            <p className="mt-2 text-micro text-muted-foreground">
              That is {taka(view.excessCents)} more than the amount due. Contact {view.merchantName}{' '}
              about the difference.
            </p>
          ) : null}
        </div>

        {view.returnUrl ? (
          <a
            href={view.returnUrl}
            className="inline-block rounded-xl bg-primary px-5 py-3 font-medium text-primary-foreground text-small"
          >
            Return to {view.merchantName}
          </a>
        ) : (
          <p className="text-micro text-muted-foreground">You can close this page.</p>
        )}
      </div>
    </Shell>
  )
}

function Closed({ view }: { view: PayView }) {
  const expired = view.status === 'expired'

  return (
    <Shell merchant={view.merchantName}>
      <div className="space-y-4 text-center">
        <h1 className="font-medium text-display">
          {expired ? 'This payment expired' : 'This payment was cancelled'}
        </h1>
        <p className="text-small text-muted-foreground">
          {expired
            ? 'Start checkout again to get a fresh reference code.'
            : 'The store cancelled this order.'}
        </p>
        {/* The one thing that must not happen next is paying twice. */}
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

/* ── Steps ────────────────────────────────────────────────────────────────── */

function MethodStep({
  view,
  methods,
  onSwitched,
  onContinue,
}: {
  view: PayView
  methods: CheckoutMethod[]
  onSwitched: (methods: CheckoutMethod[], provider: Provider) => void
  onContinue: () => void
}) {
  return (
    <Shell merchant={view.merchantName}>
      <div className="space-y-6">
        <p className="amount font-semibold text-display">{taka(view.amountCents)}</p>

        <MethodPicker
          methods={methods}
          intentId={view.id}
          canSwitch={view.canSwitchMethod}
          onSwitched={onSwitched}
        />

        <button
          type="button"
          onClick={onContinue}
          className="w-full rounded-xl bg-primary py-3 font-medium text-primary-foreground text-small"
        >
          Continue
        </button>
      </div>
    </Shell>
  )
}

/**
 * Required, not optional.
 *
 * The sender's number is worth 60 points to the scorer, so a buyer who gives it
 * is far more likely to be matched the moment their message lands. There was a
 * Skip here and it was a mistake: it is one field, the buyer certainly knows the
 * answer, and the only thing skipping achieves is making their own payment
 * slower to confirm. An escape hatch nobody benefits from is just a worse path
 * offered politely.
 */
function PayerStep({
  view,
  methodLabel,
  value,
  onChange,
  onDone,
}: {
  view: PayView
  methodLabel: string
  value: string
  onChange: (value: string) => void
  onDone: () => void
}) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const digits = value.replace(/\D/g, '')
  const valid = /^01[3-9]\d{8}$/.test(digits)
  const touched = digits.length > 0

  /*
   * Blocking, not best-effort.
   *
   * This used to fire and forget so the instructions always appeared. That was
   * a Skip button wearing a disguise: a dropped request silently cost the
   * matching signal and nobody found out. If the number is required then the
   * write has to land, and a failure is the buyer's to see and retry.
   *
   * `stored: false` is success, not failure — it means the number was already
   * set, by the store at creation or by this buyer on a previous visit.
   */
  async function submit() {
    if (!valid || pending) return
    setPending(true)
    setError(null)

    try {
      const response = await fetch(`/api/pay/${view.id}/payer`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ msisdn: digits }),
      })

      if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        setError(body?.error?.message ?? 'Could not save that number. Try again.')
        return
      }

      onDone()
    } catch {
      setError('Could not reach us. Check your connection and try again.')
    } finally {
      setPending(false)
    }
  }

  return (
    <Shell merchant={view.merchantName}>
      <div className="space-y-6">
        <div>
          <h1 className="amount font-semibold text-display">{taka(view.amountCents)}</h1>
          <p className="mt-2 text-small text-muted-foreground">
            Which {methodLabel} number will you send from? It helps us match your payment faster.
          </p>
        </div>

        <div className="space-y-1.5">
          <input
            inputMode="numeric"
            autoComplete="tel"
            value={value}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void submit()
            }}
            placeholder="01XXXXXXXXX"
            aria-label="Your number"
            aria-invalid={touched && !valid}
            className="figure w-full rounded-xl border border-border bg-background px-4 py-3 text-title"
          />
          {/* Only once they have started typing. Telling somebody their empty
              field is wrong before they touch it is nagging, not helping. */}
          {touched && !valid ? (
            <p className="text-micro text-muted-foreground">Eleven digits, starting 01.</p>
          ) : null}
        </div>

        {error ? <p className="text-micro text-ambiguous">{error}</p> : null}

        <button
          type="button"
          onClick={submit}
          disabled={!valid || pending}
          className="w-full rounded-xl bg-primary py-3 font-medium text-primary-foreground text-small disabled:opacity-50"
        >
          {pending ? 'Saving' : 'Continue'}
        </button>
      </div>
    </Shell>
  )
}

function PartialNotice({ view }: { view: PayView }) {
  return (
    <div className="space-y-2 rounded-xl border border-pending/40 bg-pending-subtle px-4 py-3 text-pending-subtle-foreground">
      <p className="text-small">
        {taka(view.receivedAmountCents)} received. Send the remaining {taka(view.shortfallCents)}{' '}
        using the same reference.
      </p>
      {/* Every instalment, named. A second request for money with no account of
          the first reads as a mistake or a scam. */}
      <ul className="space-y-0.5">
        {view.payments.map((payment) => (
          <li key={payment.trxId ?? payment.appliedAt} className="text-micro opacity-90">
            <span className="figure">{payment.trxId ?? '—'}</span> · {taka(payment.amountCents)}
          </li>
        ))}
      </ul>
    </div>
  )
}

/* ── The page ─────────────────────────────────────────────────────────────── */

type Step = 'method' | 'payer' | 'pay'

export function PayClient({ initial }: { initial: PayView }) {
  const [view, setView] = useState(initial)
  const [methods, setMethods] = useState<CheckoutMethod[]>(initial.methods)
  const [buyerMsisdn, setBuyerMsisdn] = useState('')
  const [guideFullscreen, setGuideFullscreen] = useState(false)

  /*
   * The manual TrxID box stays out of the way at first.
   *
   * Matching normally happens within seconds of the message reaching the phone,
   * so offering a form up front invites the buyer to do work the system was
   * about to do for them — and a `not_found` on a payment that simply had not
   * landed yet reads as a failure when nothing is wrong. It appears once the
   * automatic path has had a fair run, or immediately if they are already
   * part-paid and clearly mid-flow.
   */
  const [autoWindowElapsed, setAutoWindowElapsed] = useState(false)

  /*
   * Show the methods whenever the store left the choice open, even if only one
   * is selectable today. Listing what is supported — and what is not, and why —
   * is part of the answer; a checkout that jumps straight past it leaves the
   * buyer wondering whether they are on the right page.
   *
   * Skipped only when there is genuinely nothing to decide: the store named a
   * provider, or money has already arrived and pinned the account.
   */
  const [step, setStep] = useState<Step>(() => {
    if (initial.canSwitchMethod && !initial.methodLocked) return 'method'
    // Nothing to ask if the store already recorded who is paying.
    return initial.payerKnown ? 'pay' : 'payer'
  })

  const countdown = useCountdown(view.expiresAt)

  const refresh = useCallback(async () => {
    try {
      const response = await fetch(`/api/pay/${view.id}/status`, { cache: 'no-store' })
      if (!response.ok) return
      const next = await response.json()

      setView((current) => ({
        ...current,
        status: next.status,
        receivedAmountCents: next.received_amount,
        shortfallCents: next.shortfall,
        excessCents: next.excess ?? 0,
        receivingMsisdn: next.receiving_msisdn ?? current.receivingMsisdn,
        provider: next.provider ?? current.provider,
        refCode: next.ref_code ?? current.refCode,
        payments: (next.payments ?? []).map(
          (payment: { trx_id: string | null; amount: number; applied_at: string }) => ({
            trxId: payment.trx_id,
            amountCents: payment.amount,
            appliedAt: payment.applied_at,
          }),
        ),
      }))
    } catch {
      // A dropped poll is not worth surfacing; the next tick retries.
    }
  }, [view.id])

  /*
   * Poll while it is still worth polling. The phone usually captures the message
   * within a few seconds, so this is what turns the page from instructions into
   * a receipt without the buyer touching anything.
   */
  useEffect(() => {
    if (view.status !== 'open' && view.status !== 'partial') return
    const timer = setInterval(() => void refresh(), 2500)
    return () => clearInterval(timer)
  }, [view.status, refresh])

  useEffect(() => {
    const timer = setTimeout(() => setAutoWindowElapsed(true), AUTO_MATCH_GRACE_MS)
    return () => clearTimeout(timer)
  }, [])

  if (view.status === 'matched') return <Receipt view={view} />
  if (view.status === 'expired' || view.status === 'cancelled') return <Closed view={view} />

  if (step === 'method') {
    return (
      <MethodStep
        view={view}
        methods={methods}
        onSwitched={(next, provider) => {
          setMethods(next)
          setView((current) => ({ ...current, provider }))
          void refresh()
        }}
        onContinue={() => setStep(view.payerKnown ? 'pay' : 'payer')}
      />
    )
  }

  if (step === 'payer') {
    return (
      <PayerStep
        view={view}
        methodLabel={methods.find((method) => method.selected)?.label ?? ''}
        value={buyerMsisdn}
        onChange={setBuyerMsisdn}
        onDone={() => setStep('pay')}
      />
    )
  }

  const buyerDigits = buyerMsisdn.replace(/\D/g, '')
  const guideData = {
    msisdn: view.receivingMsisdn,
    amount: taka(view.shortfallCents),
    refCode: view.refCode ?? '',
    buyerLabel: buyerDigits.length >= 11 ? buyerDigits : 'You',
  }
  const guideAvailable = hasGuide(view.provider)

  /*
   * A whole page rather than a dialog on a phone. The mock is 577px tall; inside
   * a dialog on a 667px screen it becomes a scrolling box within a scrolling
   * page, and the buyer loses sight of the number they came for.
   */
  if (guideFullscreen) {
    return (
      <main className="min-h-svh px-4 py-5">
        <div className="mx-auto flex max-w-md flex-col gap-4">
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => setGuideFullscreen(false)}
              className="rounded-lg border border-border px-3 py-1.5 text-micro"
            >
              ← Back
            </button>
            <span className="figure text-micro text-muted-foreground">
              {taka(view.shortfallCents)} · {view.refCode}
            </span>
          </div>
          <ProviderGuide provider={view.provider} data={guideData} />
        </div>
      </main>
    )
  }

  const details = (
    <div className="space-y-6">
      <div className="flex items-baseline justify-between gap-3">
        <h1 className="amount font-semibold text-display">{taka(view.shortfallCents)}</h1>
        <span className="figure text-small text-muted-foreground">{countdown} left</span>
      </div>

      {view.status === 'partial' ? <PartialNotice view={view} /> : null}

      <div className="space-y-2">
        <CopyRow label="Send to" value={view.receivingMsisdn} />
        <CopyRow label="Amount" value={(view.shortfallCents / 100).toFixed(2)} />
        {view.refCode ? <CopyRow label="Reference" value={view.refCode} /> : null}
      </div>

      {guideAvailable ? (
        <button
          type="button"
          onClick={() => setGuideFullscreen(true)}
          className="w-full rounded-xl border border-border py-3 text-small transition-colors hover:bg-accent md:hidden"
        >
          Show me how to pay
        </button>
      ) : null}

      <div className="flex items-center gap-3 rounded-xl border border-border px-4 py-3">
        <span className="inline-block size-2 shrink-0 animate-pulse rounded-full bg-pending" />
        <span className="min-w-0">
          <span className="block text-small">Checking for your payment automatically</span>
          <span className="block text-micro text-muted-foreground">
            This page confirms by itself — you do not need to do anything else.
          </span>
        </span>
      </div>

      {/* Offered late, and never instead of the automatic check — polling keys
          off the intent status alone, so it carries on regardless of what a
          manual attempt returns. */}
      {autoWindowElapsed || view.status === 'partial' ? (
        <TrxVerify intentId={view.id} taka={taka} onResolved={() => void refresh()} />
      ) : null}
    </div>
  )

  return (
    <Shell merchant={view.merchantName} wide={guideAvailable}>
      {guideAvailable ? (
        <div className="flex flex-col gap-10 md:flex-row md:items-start">
          <div className="mx-auto w-full max-w-sm md:mx-0 md:flex-1">{details}</div>
          <div className="hidden md:block">
            <ProviderGuide provider={view.provider} data={guideData} />
          </div>
        </div>
      ) : (
        <div className="mx-auto w-full max-w-sm">{details}</div>
      )}
    </Shell>
  )
}
