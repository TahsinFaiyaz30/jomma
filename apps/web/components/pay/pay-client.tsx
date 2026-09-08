'use client'

import type { Provider } from '@jomma/shared'
import { useCallback, useEffect, useState } from 'react'
import { ThemeSegmented } from '@/components/theme-toggle'
import type { CheckoutMethod } from '@/lib/services/checkout'
import type { PayView } from '@/lib/services/pay-page'
import { hasGuide, ProviderGuide } from './guides'
import { MethodPicker } from './method-picker'
import { RefundRequest } from './refund-request'
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

/**
 * Time left, or null until the browser has taken over.
 *
 * Null on purpose for the first render. Seeding the state with
 * `Date.now()` reads naturally and is a hydration mismatch by construction:
 * the server renders the clock at one instant, the browser re-renders it at
 * another, and a page held open for a second between the two disagreed —
 * `48:54` against `48:53`. React answers that by throwing away the
 * server-rendered subtree and rebuilding it on the client, on the one page in
 * this product where a buyer is waiting and the server HTML is worth the most.
 *
 * Returning null makes both first renders identical, and the effect fills the
 * real figure in on the same tick it mounts. The caller reserves the space so
 * nothing moves when it appears.
 */
function useCountdown(expiresAt: string): string | null {
  const [left, setLeft] = useState<number | null>(null)

  useEffect(() => {
    const tick = () => setLeft(Date.parse(expiresAt) - Date.now())
    tick()
    const timer = setInterval(tick, 1000)
    return () => clearInterval(timer)
  }, [expiresAt])

  if (left === null) return null
  if (left <= 0) return '0:00'
  const total = Math.floor(left / 1000)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

/**
 * Whether the QR is on screen, which `md:` decides in CSS and this mirrors.
 *
 * Duplicating a breakpoint is normally a smell and is the right call here: the
 * token behind the QR is minted and revoked in JavaScript, and a phone that
 * never shows a code should neither mint one nor warn about cancelling it. The
 * alternative is a POST on every mobile checkout for a code nobody can see.
 *
 * False for the first render on both sides, so there is no mismatch to
 * reconcile — same reason `useCountdown` starts at null.
 */
function useShowsQr(): boolean {
  const [wide, setWide] = useState(false)

  useEffect(() => {
    const query = window.matchMedia('(min-width: 768px)')
    const sync = () => setWide(query.matches)
    sync()
    query.addEventListener('change', sync)
    return () => query.removeEventListener('change', sync)
  }, [])

  return wide
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

/**
 * Scan to carry this page to a phone.
 *
 * Not a bKash QR, and deliberately not dressed as one. bKash only scans QRs
 * bKash itself issued, and its Send Money flow has no amount or reference field
 * to fill from a link anyway — see lib/services/qr.ts for the full account of
 * what was tried. Promising a scan-and-pay here would fail in the buyer's hand
 * at the worst possible moment.
 *
 * What it does instead is worth having on its own: a buyer at a laptop has
 * bKash on a phone that has none of this on it, and their alternative is
 * copying eleven digits and an eight-character code across by eye.
 *
 * The `token` is what makes the scan a handoff. The phone opens the link and
 * lands on these same instructions rather than on the wallet question this
 * screen has already answered — and it lands there with no way back, because
 * the answers live here. Nothing renders until there is one, so the code on
 * screen is always one the server will still honour.
 *
 * Desktop only, because on a phone it is a picture of the page you are looking
 * at. The download is for the case the camera app will not cooperate, or the
 * buyer wants it in their gallery before switching apps.
 */
function ScanToPhone({ intentId, token }: { intentId: string; token: string }) {
  const src = `/api/pay/${intentId}/qr?h=${encodeURIComponent(token)}`

  return (
    <div className="hidden items-center gap-4 rounded-xl border border-border px-4 py-4 md:flex">
      {/* Plain <img>: the source is a dynamic route, so there is nothing for the
          image optimiser to do but add a hop. White plate regardless of theme —
          an inverted QR does not scan. */}
      {/* biome-ignore lint/performance/noImgElement: dynamic route, not a static asset */}
      <img
        src={src}
        alt="QR code that opens this payment page"
        width={112}
        height={112}
        /* `hidden` on the parent does not stop a plain <img> being fetched, so
           without this every buyer on a phone pays for an image they are never
           shown — on mobile data, mid-checkout. A lazy image inside a
           display:none subtree never intersects, so it is never requested. */
        loading="lazy"
        decoding="async"
        className="size-28 shrink-0 rounded-lg bg-white"
      />
      <div className="min-w-0 space-y-1.5">
        <p className="text-small">Open on another device</p>
        {/* The last line is not padding. Somebody looking at a QR on a payment
            page will try it in bKash, get "invalid QR", and conclude the page
            is broken. Saying which app to point at it costs six words. */}
        <p className="text-micro text-muted-foreground">
          Scan this QR code to open this page on your phone — the number, amount and reference come
          with it. Use your camera app, not bKash.
        </p>
        <a
          href={src}
          download={`jomma-${intentId}.png`}
          className="inline-block rounded-lg border border-border px-3 py-1.5 text-micro transition-colors hover:bg-accent"
        >
          Download QR
        </a>
      </div>
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

        {/* Folded away, and only after the good news. An over-payment completes
            the order on its own, so without this the buyer is out of pocket with
            nothing to press. */}
        <RefundRequest
          intentId={view.id}
          merchant={view.merchantName}
          excessCents={view.excessCents}
          taka={taka}
        />
      </div>
    </Shell>
  )
}

/**
 * The merchant has been stopped by the platform, so there is nothing to pay to.
 *
 * Shown instead of the instructions rather than instead of the page. Somebody
 * looking at this may have sent money minutes ago, and the two things they need
 * — that it was recorded, and that they must not send more — are both here.
 * What is not here is the number and the reference code, which together are the
 * whole instruction and are withheld server-side as well.
 */
function NotAccepting({ view }: { view: PayView }) {
  const received = view.receivedAmountCents > 0

  return (
    <Shell merchant={view.merchantName}>
      <div className="space-y-4 text-center">
        <h1 className="font-medium text-display">This shop cannot take payments</h1>
        <p className="text-small text-muted-foreground">
          {view.merchantName} is not able to accept payments at the moment, so this order cannot be
          paid.
        </p>

        {received ? (
          <p className="text-small">
            {taka(view.receivedAmountCents)} you already sent has been recorded against this order.
            Contact {view.merchantName} about it.
          </p>
        ) : null}

        {/* The one thing that must not happen next is sending money anyway. */}
        <p className="text-micro text-muted-foreground">
          Do not send any money for this order. Anything sent now would not be matched to it.
        </p>
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

/**
 * This phone was scanned in, and the screen it came from has moved on.
 *
 * The buyer went back on the other device, which lets them pick a different
 * wallet — and that re-routes the intent to a different receiving number. This
 * page is holding the old one. Showing it anyway would be the worst thing on
 * offer: an instruction from Jomma, on Jomma's own page, to send money to an
 * account this payment is no longer pointing at.
 *
 * So the number, the amount and the reference all go, and what is left is the
 * one sentence that matters and where to get a working code. There is no link
 * back into the flow on purpose: the answers are being given on the other
 * screen, and a second device wandering into them is how the two disagree.
 */
function HandoffCancelled({ view }: { view: PayView }) {
  return (
    <Shell merchant={view.merchantName}>
      <div className="space-y-4 text-center">
        <h1 className="font-medium text-display">This code was cancelled</h1>
        <p className="text-small text-muted-foreground">
          The payment was changed on the device you scanned from, so these details are out of date.
        </p>
        <p className="text-small">
          Go back to that screen and scan the new code to carry the payment across again.
        </p>
        {/* The one thing that must not happen next is paying against a number
            that is no longer this payment's. */}
        <p className="text-micro text-muted-foreground">
          Do not send money using anything you copied from this page. If you already have, contact{' '}
          {view.merchantName}.
        </p>
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
 * Confirming the number the store already gave us.
 *
 * The store's value is a suggestion, not a fact — checkout collects a delivery
 * phone, and the money arrives from whoever is paying. So this asks rather than
 * assumes, which is one tap for the common case where the guess was right and
 * the only way the wrong case gets caught at all.
 *
 * Shown after the wallet is chosen, because the question is about *that*
 * wallet's number, and asked masked, because this page is visible to anyone
 * holding the link.
 *
 * "Yes" writes, despite the value already being stored. It is not the number
 * that changes but who vouched for it, and without recording that, a reload
 * would put the buyer straight back here — which is the thing this whole flow
 * is trying not to do to people mid-payment.
 */
function ConfirmPayerStep({
  view,
  methodLabel,
  onConfirmed,
  onUseDifferent,
  onBack,
}: {
  view: PayView
  methodLabel: string
  onConfirmed: () => void
  onUseDifferent: () => void
  /** Null when the wallet was never the buyer's to choose. */
  onBack: (() => void) | null
}) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function confirm() {
    if (pending) return
    setPending(true)
    setError(null)

    try {
      /*
       * Blocking, like the typed path, and for the same reason: a dropped
       * request here would leave the intent looking unanswered and cost the
       * matching signal, with nobody the wiser.
       */
      const response = await fetch(`/api/pay/${view.id}/payer/confirm`, { method: 'POST' })
      if (!response.ok) {
        setError('Could not save that. Try again.')
        return
      }
      onConfirmed()
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
            Will you be sending from this {methodLabel} number? It helps us match your payment
            faster.
          </p>
        </div>

        <p className="figure rounded-xl border border-border bg-muted/40 px-4 py-3 text-title">
          {view.payerSuggestion}
        </p>

        {error ? <p className="text-micro text-ambiguous">{error}</p> : null}

        {/*
          Stacked on a phone, side by side once there is room.
          
          Full-width buttons one above the other is the right shape at 360px and
          a waste of a wide screen — and stacking makes the second option read
          as an afterthought when both are ordinary answers to the question.
        */}
        <div className="flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            onClick={confirm}
            disabled={pending}
            className="flex-1 rounded-xl bg-primary py-3 font-medium text-primary-foreground text-small disabled:opacity-50"
          >
            {pending ? 'Saving' : 'Yes, use this'}
          </button>
          <button
            type="button"
            onClick={onUseDifferent}
            disabled={pending}
            className="flex-1 rounded-xl border border-border py-3 font-medium text-small disabled:opacity-50"
          >
            Use a different number
          </button>
        </div>

        {onBack ? <BackToMethod onBack={onBack} /> : null}
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
  onBack,
}: {
  view: PayView
  methodLabel: string
  value: string
  onChange: (value: string) => void
  onDone: () => void
  /** Null when the wallet was never the buyer's to choose. */
  onBack: (() => void) | null
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

        {onBack ? <BackToMethod onBack={onBack} /> : null}
      </div>
    </Shell>
  )
}

/**
 * The way back out of the instructions, and the warning it owes the buyer.
 *
 * Until this existed the instructions were a dead end: a buyer who picked bKash
 * and then found their balance was on the other wallet had no move except
 * abandoning the checkout. So there is a way back, and it goes all the way to
 * the wallet question rather than one step — the number in between has already
 * been answered and re-asking it is the thing this page keeps getting wrong.
 *
 * It asks first, because going back is not free. Choosing a different wallet
 * re-routes the intent to a different receiving number, so the QR on this
 * screen — and any phone that has already scanned it — is holding an
 * instruction that is about to stop being true. The confirmation names that in
 * the buyer's terms: the code stops working, the other screen stops showing the
 * number.
 *
 * The revoke blocks, and a failure keeps the buyer here. Moving on regardless
 * would leave a live code on a payment that has moved, which is the one outcome
 * the warning is promising will not happen.
 */
function ChangeMethod({
  intentId,
  qrLive,
  onLeft,
}: {
  intentId: string
  /** A code has been handed out, so a phone may be holding these details. */
  qrLive: boolean
  onLeft: () => void
}) {
  const [asking, setAsking] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function leave() {
    if (pending) return
    setPending(true)
    setError(null)

    try {
      const response = await fetch(`/api/pay/${intentId}/handoff`, { method: 'DELETE' })
      if (!response.ok) {
        setError('Could not cancel the QR code. Try again.')
        return
      }
      onLeft()
    } catch {
      setError('Could not reach us. Check your connection and try again.')
    } finally {
      setPending(false)
    }
  }

  if (!asking) {
    return (
      <button
        type="button"
        onClick={() => setAsking(true)}
        className="text-micro text-muted-foreground underline underline-offset-4 transition-colors hover:text-foreground"
      >
        ← Change payment method
      </button>
    )
  }

  return (
    <div className="space-y-3 rounded-xl border border-ambiguous/40 bg-ambiguous-subtle px-4 py-3 text-ambiguous-subtle-foreground">
      <div className="space-y-1">
        <p className="font-medium text-small">Start this payment again?</p>
        <p className="text-micro opacity-90">
          {qrLive
            ? 'The QR code stops working, and a phone that has already scanned it will stop showing this number. You will pick a payment method again — you will not be asked for your number.'
            : 'You will pick a payment method again. You will not be asked for your number again.'}
        </p>
        {/* Named separately because it is the one case where going back is the
            wrong move, and the buyer is the only person who knows. */}
        <p className="text-micro opacity-90">
          If you have already sent the money, stay here — it will be confirmed on this page.
        </p>
      </div>

      {error ? <p className="text-micro">{error}</p> : null}

      <div className="flex flex-col gap-2 sm:flex-row">
        <button
          type="button"
          onClick={leave}
          disabled={pending}
          className="flex-1 rounded-lg border border-ambiguous/50 py-2.5 font-medium text-small transition-colors hover:bg-ambiguous/10 disabled:opacity-60"
        >
          {pending ? 'Cancelling' : 'Yes, change method'}
        </button>
        <button
          type="button"
          onClick={() => {
            setAsking(false)
            setError(null)
          }}
          disabled={pending}
          className="flex-1 rounded-lg border border-transparent py-2.5 font-medium text-small transition-colors hover:bg-ambiguous/10 disabled:opacity-60"
        >
          Stay here
        </button>
      </div>
    </div>
  )
}

/**
 * Back out of a question, before any of it is worth warning about.
 *
 * The number steps come after the wallet is chosen and before any code exists,
 * so there is nothing to revoke and nothing to caution about — it is the plain
 * back link that makes the queue a queue rather than a funnel.
 */
function BackToMethod({ onBack }: { onBack: () => void }) {
  return (
    <button
      type="button"
      onClick={onBack}
      className="text-micro text-muted-foreground underline underline-offset-4 transition-colors hover:text-foreground"
    >
      ← Change payment method
    </button>
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

type Step = 'method' | 'confirm' | 'payer' | 'pay'

/**
 * The screens that end the story, before any of the asking begins.
 *
 * Gathered into one place because they are one decision — is there still a
 * payment to walk somebody through — and leaving them as separate early
 * returns spread that decision through the middle of the component.
 *
 * Order matters. The terminal states come first deliberately: a payment that
 * already completed still shows its receipt and an expired one still says so.
 * Those are facts about the buyer's money, and a suspension arriving afterwards
 * does not change them — it only replaces the part that asks for more.
 */
function settledView(view: PayView) {
  if (view.status === 'matched') return <Receipt view={view} />
  if (view.status === 'expired' || view.status === 'cancelled') return <Closed view={view} />
  if (!view.acceptingPayments) return <NotAccepting view={view} />
  return null
}

/**
 * Where to go once the wallet is chosen.
 *
 * Three cases, and the middle one used to be missing. Nothing on record: ask.
 * The buyer has already answered, here or on an earlier visit: go straight to
 * the instructions, because re-asking somebody mid-payment reads as the page
 * having lost their answer. The store supplied a number: confirm it.
 *
 * That last case used to be treated as the second, and it is not the same
 * claim. A store collects a delivery phone at checkout; the money arrives from
 * whoever is paying, routinely a different person. Taking the suggestion as
 * settled skipped the question entirely, and a wrong number there costs the
 * matching signal with nothing in either system looking misconfigured.
 */
function firstAfterMethod(view: PayView): Step {
  if (view.payerConfirmed) return 'pay'
  return view.payerSuggestion ? 'confirm' : 'payer'
}

/**
 * The instructions, and everything that hangs off them.
 *
 * The last step of the queue and much the largest of the four: the number, the
 * amount, the reference, the walkthrough, the manual TrxID box, the code a
 * phone can scan to pick all of it up, and the way back out. Split out so that
 * `PayClient` stays what it is — the questions and the order they are asked in
 * — rather than that plus a screen.
 *
 * `onBack` is null when there is nowhere to go: a store that named the wallet,
 * a part-paid intent whose account is pinned, or a page that is itself the far
 * end of a handoff.
 */
function InstructionsStep({
  view,
  buyerMsisdn,
  autoWindowElapsed,
  qrToken,
  onBack,
  onRefresh,
}: {
  view: PayView
  buyerMsisdn: string
  autoWindowElapsed: boolean
  /** The code a phone can scan to pick these instructions up, if any. */
  qrToken: string | null
  onBack: (() => void) | null
  onRefresh: () => void
}) {
  const [guideFullscreen, setGuideFullscreen] = useState(false)
  const countdown = useCountdown(view.expiresAt)

  const buyerDigits = buyerMsisdn.replace(/\D/g, '')
  /*
   * Both are non-null by the time this renders: `settledView` in `PayClient`
   * returns `NotAccepting` whenever they are not, since a page with no number
   * to send to has nothing to guide anybody through. Stated rather than
   * assumed, so the fallbacks are visibly dead code and not a silently blank
   * instruction if that order ever changes.
   */
  const guideData = {
    msisdn: view.receivingMsisdn ?? '',
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
      {qrToken ? <ScanToPhone intentId={view.id} token={qrToken} /> : null}

      <div className="flex items-baseline justify-between gap-3">
        <h1 className="amount font-semibold text-display">{taka(view.shortfallCents)}</h1>
        {/*
         * Space held whether or not there is a figure yet, so the amount beside
         * it does not shift when the first tick lands. `aria-hidden` while it is
         * empty keeps a screen reader from announcing a bare "left".
         */}
        <span
          className="figure min-w-[4.5rem] text-right text-small text-muted-foreground"
          aria-hidden={countdown === null}
        >
          {countdown === null ? ' ' : `${countdown} left`}
        </span>
      </div>

      {view.status === 'partial' ? <PartialNotice view={view} /> : null}

      <div className="space-y-2">
        {view.receivingMsisdn ? <CopyRow label="Send to" value={view.receivingMsisdn} /> : null}
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
        <TrxVerify intentId={view.id} taka={taka} onResolved={() => onRefresh()} />
      ) : null}

      {/* Last, and quiet. It is the escape hatch for somebody who chose the
          wrong wallet, not a step in paying — a prominent Back at the top of
          the instructions invites people out of a flow they were finishing. */}
      {onBack ? (
        <ChangeMethod intentId={view.id} qrLive={qrToken !== null} onLeft={onBack} />
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

/**
 * How this page was opened.
 *
 * `live` means somebody scanned the QR on another screen and this is the far
 * end of a handoff: the questions were answered over there and this page shows
 * the instructions and nothing else. `revoked` means they were answered over
 * there and then unanswered — the buyer went back — so the details on offer
 * here may point at an account this payment no longer uses.
 */
export type Handoff = 'none' | 'live' | 'revoked'

/**
 * The handoff, from the screen that owns it.
 *
 * Three moving parts of one mechanism: mint the code while the instructions are
 * on screen, drop it when the buyer leaves them, and remember once the far end
 * has been told to let go. Kept together and out of `PayClient` because the
 * order they happen in is the whole correctness argument, and reading it
 * scattered through a component that also runs a four-step queue is how that
 * argument gets broken by accident.
 *
 * `handing` is the caller's judgement that this screen is currently showing a
 * number worth carrying elsewhere. Minting is idempotent server-side, so a
 * remount, a second tab, or React invoking the effect twice all land on the
 * same token rather than each invalidating the last one's QR.
 */
function useHandoff({
  intentId,
  arrivedRevoked,
  handing,
}: {
  intentId: string
  arrivedRevoked: boolean
  handing: boolean
}) {
  const [token, setToken] = useState<string | null>(null)
  const [cancelled, setCancelled] = useState(arrivedRevoked)

  useEffect(() => {
    if (!handing) return

    let abandoned = false
    void (async () => {
      try {
        const response = await fetch(`/api/pay/${intentId}/handoff`, { method: 'POST' })
        if (!response.ok) return
        const body = await response.json()
        if (!abandoned && typeof body?.token === 'string') setToken(body.token)
      } catch {
        // No token, no QR. Every other way this page offers of paying still
        // works, so it is not worth putting an error in front of anybody.
      }
    })()

    return () => {
      abandoned = true
    }
  }, [intentId, handing])

  return {
    token,
    cancelled,
    /** The far end has been let go of, and must stop showing a number. */
    cancel: useCallback(() => setCancelled(true), []),
    /** This screen has stopped handing anything out. */
    drop: useCallback(() => setToken(null), []),
  }
}

export function PayClient({
  initial,
  handoff,
  handoffToken,
}: {
  initial: PayView
  handoff: Handoff
  /** What arrived in the URL, echoed on the poll so it can be re-checked. */
  handoffToken: string | null
}) {
  const [view, setView] = useState(initial)
  const [methods, setMethods] = useState<CheckoutMethod[]>(initial.methods)
  const [buyerMsisdn, setBuyerMsisdn] = useState('')

  /** This browser came in by scanning, so the flow belongs to the other one. */
  const scanned = handoff !== 'none'

  /** Only the layout that draws a QR mints the token behind it. */
  const showsQr = useShowsQr()

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
    /*
     * A scanned page starts at the end, always.
     *
     * This is the whole point of the handoff. The buyer chose a wallet and
     * vouched for a number on the screen they scanned from; putting those
     * questions in front of them a second time on a second device is what they
     * picked up the phone to avoid. A revoked token lands here too and is
     * caught below — the step it would have taken is never rendered.
     */
    if (handoff !== 'none') return 'pay'
    if (initial.canSwitchMethod && !initial.methodLocked) return 'method'
    return firstAfterMethod(initial)
  })

  /**
   * Whether the buyer may walk back to the wallet question.
   *
   * Not on a scanned page: the answers are the other screen's, and a phone
   * changing them while that screen is still showing the old ones is how the
   * two end up disagreeing about where the money goes.
   *
   * Not when there is no choice to go back to either — a store that named a
   * provider, or a part-paid intent whose account is pinned. A back link onto a
   * picker that refuses every option is worse than none.
   */
  const canGoBack = !scanned && view.canSwitchMethod && !view.methodLocked

  /*
   * Hand out a code only while this screen is genuinely showing a number worth
   * carrying: the instructions are up, the merchant may be paid, the payment is
   * still open, this is not itself the far end of somebody else's handoff, and
   * the layout actually draws the QR.
   */
  const {
    token: qrToken,
    cancelled: handoffCancelled,
    cancel: cancelHandoff,
    drop: dropHandoff,
  } = useHandoff({
    intentId: view.id,
    arrivedRevoked: handoff === 'revoked',
    handing:
      !scanned &&
      showsQr &&
      step === 'pay' &&
      view.acceptingPayments &&
      (view.status === 'open' || view.status === 'partial'),
  })

  /*
   * Resume where they were, rather than restarting the queue on every reload.
   *
   * The step is component state, so a refresh — or coming back to the tab after
   * switching to bKash, which is the single most likely thing to happen on this
   * page — sent the buyer back to a method picker they had already answered and
   * a number they had already given. Asking someone the same two questions
   * again mid-payment reads as the page having lost their answers.
   *
   * Session storage rather than the database, because this is where somebody
   * got to in a form, not a fact about the payment. It is scoped to the tab and
   * to this intent, and losing it costs two taps.
   *
   * Applied in an effect because the server render cannot see it. That leaves
   * one frame on the first step before it corrects, which beats the same frame
   * appearing on every reload for the rest of the payment.
   *
   * Skipped on a scanned page. There the URL says which step to be on, and it is
   * the more recent of the two — a phone that scanned an earlier code for this
   * same payment would otherwise be resumed into instructions that have since
   * been cancelled.
   */
  useEffect(() => {
    if (scanned) return
    try {
      if (sessionStorage.getItem(`jomma:pay:${view.id}`) === 'pay') setStep('pay')
    } catch {
      // Private browsing, or storage disabled. The queue still works.
    }
  }, [scanned, view.id])

  useEffect(() => {
    if (scanned || step !== 'pay') return
    try {
      sessionStorage.setItem(`jomma:pay:${view.id}`, 'pay')
    } catch {
      // As above — remembering is an improvement, not a requirement.
    }
  }, [scanned, step, view.id])

  const refresh = useCallback(async () => {
    try {
      /*
       * The token rides along so the answer can say whether it is still the one
       * being handed out. Without it a scanned phone has no way to learn that
       * the screen it came from went back, and would quietly adopt the new
       * receiving number below — swapping where to send money under somebody
       * who is halfway through sending it.
       */
      const query = handoffToken ? `?h=${encodeURIComponent(handoffToken)}` : ''
      const response = await fetch(`/api/pay/${view.id}/status${query}`, { cache: 'no-store' })
      if (!response.ok) return
      const next = await response.json()

      if (next.handoff_valid === false) cancelHandoff()

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
  }, [view.id, handoffToken, cancelHandoff])

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

  /**
   * All the way back to the wallet question, never one step.
   *
   * The number in between has been answered and recorded, and re-asking it is
   * the thing this page keeps having to be told not to do. Going forward again
   * runs straight through it: `firstAfterMethod` reads `payerConfirmed` and
   * lands on the instructions.
   *
   * The stored step goes with it, or a reload a moment later would put the
   * buyer back on instructions they just left.
   */
  function backToMethod() {
    try {
      sessionStorage.removeItem(`jomma:pay:${view.id}`)
    } catch {
      // Never stored in the first place. Nothing to undo.
    }
    dropHandoff()
    setStep('method')
  }

  const settled = settledView(view)
  if (settled) return settled

  /*
   * After the settled states, deliberately. A payment that landed before the
   * other screen went back still shows its receipt — that is a fact about the
   * buyer's money and the more useful of the two answers. This only replaces
   * the part that is still asking for some.
   */
  if (handoffCancelled) return <HandoffCancelled view={view} />

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
        onContinue={() => setStep(firstAfterMethod(view))}
      />
    )
  }

  if (step === 'confirm') {
    return (
      <ConfirmPayerStep
        view={view}
        methodLabel={methods.find((method) => method.selected)?.label ?? ''}
        onConfirmed={() => {
          // Confirmed is answered: the page must not ask again on reload.
          setView((current) => ({ ...current, payerConfirmed: true, payerSuggestion: null }))
          setStep('pay')
        }}
        onUseDifferent={() => setStep('payer')}
        onBack={canGoBack ? backToMethod : null}
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
        onBack={canGoBack ? backToMethod : null}
      />
    )
  }

  return (
    <InstructionsStep
      view={view}
      buyerMsisdn={buyerMsisdn}
      autoWindowElapsed={autoWindowElapsed}
      qrToken={qrToken}
      onBack={canGoBack ? backToMethod : null}
      onRefresh={() => void refresh()}
    />
  )
}
