'use client'

import { useCallback, useEffect, useState, useTransition } from 'react'
import { toast } from 'sonner'
import {
  refreshSetupAction,
  type SetupResult,
  setupAddAccountFromSimAction,
  setupAddEndpointAction,
  setupApproveDeviceAction,
  setupCreateAppAction,
  setupCreateKeyAction,
  setupDeclineDeviceAction,
  setupEnableAccountAction,
  setupListSimsAction,
  setupPairPhoneAction,
} from '@/app/setup/actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import type { SetupState, SetupStepId } from '@/lib/services/onboarding'
import type { SimOption } from '@/lib/services/sim-accounts'

/**
 * First-run setup.
 *
 * One screen, one question at a time, in the order the dependencies actually
 * run: a number, a phone watching it, the account switched on, a business, a
 * key. A fresh instance otherwise lands on six empty tables whose empty states
 * are indistinguishable from a quiet day.
 *
 * Steps cannot be skipped ahead of their dependency, because each one needs
 * something the previous created — there is no id to hang a device off before
 * an account exists. Completion is recomputed server-side from what is in the
 * database after every action, so nothing here can mark itself done.
 */

export function SetupWizard({ initial }: { initial: SetupState }) {
  const [state, setState] = useState(initial)
  const [pending, startTransition] = useTransition()
  const [secret, setSecret] = useState<SetupResult['secret'] | null>(null)

  // Field state, one per step that needs input.
  const [msisdn, setMsisdn] = useState('')
  const [label, setLabel] = useState('')
  const [provider, setProvider] = useState<'bkash' | 'nagad'>('bkash')
  const [deviceName, setDeviceName] = useState('Shop phone')
  const [appName, setAppName] = useState('')
  const [endpointUrl, setEndpointUrl] = useState('')

  /*
   * A step the operator is staying on, even though the server calls it done.
   *
   * `currentStepId` is the first unfinished step, and following it blindly
   * meant approving a phone threw the screen forward to choosing a SIM. A
   * business runs more than one handset — a till phone and a back-office phone,
   * or one per SIM — so finishing the first one is not a reason to close the
   * step that connects them. Approving pins it; moving on is a button.
   *
   * Only ever set to a step the person is looking at, so it cannot pin one
   * whose dependency has not been created yet.
   */
  const [pinnedStepId, setPinnedStepId] = useState<SetupStepId | null>(null)
  const openStepId = pinnedStepId ?? state.currentStepId

  const requiredDone = state.steps.filter((s) => s.required && s.done).length
  const requiredTotal = state.steps.filter((s) => s.required).length

  const run = (fn: () => Promise<SetupResult>) =>
    startTransition(async () => {
      const result = await fn()
      setState(result.state)
      if (result.secret) setSecret(result.secret)
      if (result.message) {
        if (result.ok) toast.success(result.message)
        else toast.error(result.message)
      }
    })

  /*
   * Two steps complete off-screen, so poll while either is the open one.
   *
   * `phone` finishes when somebody walks to a handset and scans a code, and
   * `account` needs that phone to report its SIMs on a heartbeat before there
   * is anything to choose from — both leave a browser sitting on a screen that
   * would otherwise never change by itself.
   */
  useEffect(() => {
    if (openStepId !== 'phone' && openStepId !== 'account') return
    const timer = setInterval(() => {
      startTransition(async () => setState((await refreshSetupAction()).state))
    }, 4000)
    return () => clearInterval(timer)
  }, [openStepId])

  /*
   * A code that has been used stops being shown.
   *
   * A pairing code is single-use, so the QR on screen goes stale the instant
   * somebody scans it — and it stayed up, inviting a second phone to scan
   * something that could no longer work and giving no clue why. Watching for
   * the device it was minted for is exact: no guessing from counts, and a code
   * nobody has scanned stays up for as long as it is valid.
   */
  useEffect(() => {
    const id = secret?.deviceId
    if (!id) return
    const used = [...state.pendingPhones, ...state.connectedPhones].some((p) => p.id === id)
    if (used) setSecret(null)
  }, [secret, state.pendingPhones, state.connectedPhones])

  const digits = msisdn.replace(/\D/g, '')
  const msisdnValid = /^(880)?1[3-9]\d{8}$/.test(digits.startsWith('0') ? digits.slice(1) : digits)

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-3xl flex-col justify-center px-5 py-10">
      <header className="mb-7">
        <p className="text-micro text-muted-foreground">Setting up Jomma</p>
        <h1 className="mt-1 font-semibold text-display">
          {state.complete ? 'Ready to take payments' : 'A few things first'}
        </h1>
        <p className="mt-2 max-w-prose text-small text-muted-foreground">
          {state.complete
            ? 'Everything required is in place. The last step is optional.'
            : 'Nothing can take a payment until these are done. Each one needs the one before it.'}
        </p>

        <div className="mt-4 flex items-center gap-3">
          <div className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-foreground transition-all"
              style={{ width: `${(requiredDone / requiredTotal) * 100}%` }}
            />
          </div>
          <span className="figure shrink-0 text-micro text-muted-foreground">
            {requiredDone}/{requiredTotal}
          </span>
        </div>
      </header>

      <ol className="space-y-2">
        {state.steps.map((step, index) => (
          <StepRow
            key={step.id}
            step={step}
            index={index}
            isCurrent={step.id === openStepId}
            onStay={() => setPinnedStepId(step.id)}
            onMoveOn={() => setPinnedStepId(null)}
            state={state}
            pending={pending}
            run={run}
            secret={secret}
            onDismissSecret={() => setSecret(null)}
            fields={{
              msisdn,
              setMsisdn,
              msisdnValid,
              label,
              setLabel,
              provider,
              setProvider,
              deviceName,
              setDeviceName,
              appName,
              setAppName,
              endpointUrl,
              setEndpointUrl,
            }}
          />
        ))}
      </ol>

      {state.complete ? (
        <a
          href="/"
          className="mt-7 inline-flex items-center justify-center self-start rounded-xl bg-primary px-5 py-3 font-medium text-primary-foreground text-small"
        >
          Go to the dashboard
        </a>
      ) : null}
    </main>
  )
}

interface Fields {
  msisdn: string
  setMsisdn: (v: string) => void
  msisdnValid: boolean
  label: string
  setLabel: (v: string) => void
  provider: 'bkash' | 'nagad'
  setProvider: (v: 'bkash' | 'nagad') => void
  deviceName: string
  setDeviceName: (v: string) => void
  appName: string
  setAppName: (v: string) => void
  endpointUrl: string
  setEndpointUrl: (v: string) => void
}

/**
 * Choosing which SIM this business gets paid on.
 *
 * The step that replaced a phone-number field. The list is whatever the phone
 * last reported on a heartbeat, so it can be a minute or two behind the tray —
 * hence the refresh, and hence the server re-checking the choice rather than
 * trusting what this screen offered it.
 *
 * SIMs that cannot be used are shown greyed with the reason rather than left
 * out. Somebody holding a phone with two SIMs in it, looking at a screen
 * offering one, needs to be told which is missing and why.
 */
function SimPicker({
  state,
  pending,
  run,
  fields,
}: {
  state: SetupState
  pending: boolean
  run: (fn: () => Promise<SetupResult>) => void
  fields: Fields
}) {
  const [sims, setSims] = useState<SimOption[]>([])
  const [note, setNote] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const deviceId = state.firstDeviceId

  const load = useCallback(() => {
    if (!deviceId) return
    setLoading(true)
    void setupListSimsAction(deviceId)
      .then((result) => {
        setSims(result.sims)
        setNote(result.message)
      })
      .finally(() => setLoading(false))
  }, [deviceId])

  // Once on arrival, then on demand. The phone beats every few minutes, so
  // polling here would mostly re-fetch a list that has not changed.
  useEffect(() => {
    load()
  }, [load])

  if (!deviceId) {
    return <p className="text-small text-muted-foreground">Connect a phone first.</p>
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={fields.provider}
          onChange={(e) => fields.setProvider(e.target.value as 'bkash' | 'nagad')}
          className="h-8 rounded-md border border-border bg-background px-2 text-small"
          aria-label="Provider"
        >
          <option value="bkash">bKash</option>
          <option value="nagad">Nagad (no parser yet)</option>
        </select>
        <Button size="sm" variant="outline" disabled={loading} onClick={load}>
          {loading ? <Spinner /> : null}Refresh SIMs
        </Button>
        {note ? <span className="text-micro text-muted-foreground">{note}</span> : null}
      </div>

      <div className="space-y-2">
        {sims.map((sim) => (
          <div
            key={sim.subscription_id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border px-3 py-2"
          >
            <div className="min-w-0">
              <p className="text-small">
                <span className="font-medium">SIM {sim.slot_index + 1}</span>
                {sim.carrier_name ? ` · ${sim.carrier_name}` : ''}
                <span className="text-muted-foreground"> · {sim.network_generation}</span>
              </p>
              <p className="figure text-micro text-muted-foreground">
                {sim.msisdn ?? 'Number not available from this SIM'}
                {sim.number_source ? ` · from ${sim.number_source}` : ''}
              </p>
              {sim.blockedReason ? (
                <p className="mt-0.5 text-micro text-muted-foreground">{sim.blockedReason}</p>
              ) : null}
            </div>
            <Button
              size="sm"
              disabled={pending || sim.blockedReason !== null}
              onClick={() =>
                run(() =>
                  setupAddAccountFromSimAction(deviceId, sim.subscription_id, fields.provider),
                )
              }
            >
              Use this SIM
            </Button>
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * One step in the list: its number, its copy, and — when it is the current one
 * — its form and anything that form produced.
 *
 * Extracted from the `map` that used to hold all of this inline. Not only for
 * the complexity rule: a provisioning QR is rendered *inside* the step now, and
 * the branch that does it belongs next to the branch that decides whether the
 * step is current, rather than a hundred lines away at the foot of the page.
 */
function StepRow({
  step,
  index,
  isCurrent,
  state,
  pending,
  run,
  secret,
  onDismissSecret,
  onStay,
  onMoveOn,
  fields,
}: {
  step: SetupState['steps'][number]
  index: number
  isCurrent: boolean
  state: SetupState
  pending: boolean
  run: (fn: () => Promise<SetupResult>) => void
  secret: SetupResult['secret'] | null
  onDismissSecret: () => void
  /** Keep this step open even once the server considers it finished. */
  onStay: () => void
  /** Release it, so the list follows the server's next unfinished step. */
  onMoveOn: () => void
  fields: Fields
}) {
  const locked = !step.done && !isCurrent

  return (
    <li
      className={`rounded-xl border px-4 py-3 transition-colors ${
        isCurrent ? 'border-foreground/35 bg-card' : 'border-border'
      } ${locked ? 'opacity-55' : ''}`}
    >
      <div className="flex items-start gap-3">
        <span
          className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-micro ${
            step.done
              ? 'bg-matched text-background'
              : isCurrent
                ? 'bg-foreground text-background'
                : 'border border-border text-muted-foreground'
          }`}
        >
          {step.done ? '✓' : index + 1}
        </span>

        <div className="min-w-0 flex-1">
          <p className="font-medium text-small">
            {step.title}
            {!step.required ? (
              <span className="ml-2 text-micro text-muted-foreground">optional</span>
            ) : null}
          </p>
          <p className="mt-0.5 text-micro text-muted-foreground">
            {step.done && step.detail ? step.detail : step.blurb}
          </p>

          {isCurrent ? (
            <div className="mt-3">
              <StepForm
                step={step.id}
                state={state}
                pending={pending}
                run={run}
                onStay={onStay}
                onMoveOn={onMoveOn}
                fields={fields}
              />

              {/*
               * Here, not after the list.
               *
               * A provisioning QR rendered at the foot of the page is detached
               * from the button that produced it — on a short viewport it lands
               * below the fold, so pressing "Show pairing code" looks like it
               * did nothing. It belongs to the step it came from, directly
               * under the control.
               */}
              {secret ? (
                <div className="mt-3">
                  <SecretCard secret={secret} onDismiss={onDismissSecret} />
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </li>
  )
}

function StepForm({
  step,
  state,
  pending,
  run,
  onStay,
  onMoveOn,
  fields,
}: {
  step: SetupStepId
  state: SetupState
  pending: boolean
  run: (fn: () => Promise<SetupResult>) => void
  onStay: () => void
  onMoveOn: () => void
  fields: Fields
}) {
  const busy = pending ? <Spinner /> : null

  switch (step) {
    case 'phone':
      /*
       * All of them, not the first one.
       *
       * A business runs more than one phone — a till phone and a back-office
       * phone, or one per SIM — and this step showed a single one and moved on,
       * so connecting another was something you had to know to do elsewhere.
       *
       * Scanning is also not the end of it: a provisioning QR is a bearer
       * credential that gets screenshotted and forwarded, so each phone that
       * has scanned needs approving or turning away. Approval alone was a
       * one-way door — the wrong handset kept waiting, and scanning again only
       * queued a second one behind it.
       */
      return (
        <div className="space-y-3">
          {state.connectedPhones.length > 0 ? (
            <ul className="space-y-1">
              {state.connectedPhones.map((phone) => (
                <li key={phone.id} className="text-micro text-muted-foreground">
                  <span className="text-matched">✓</span> {phone.name} — connected
                </li>
              ))}
            </ul>
          ) : null}

          {state.pendingPhones.map((phone) => (
            <div key={phone.id} className="flex flex-wrap items-center gap-2">
              <span className="text-micro">{phone.name} scanned.</span>
              <Button
                size="sm"
                disabled={pending}
                onClick={() => {
                  // Pin before running. Approving satisfies the step, and
                  // without this the screen jumped to choosing a SIM the moment
                  // the first phone went through -- with the second handset
                  // still in somebody's hand, unapproved, and the step that
                  // approves it now closed.
                  onStay()
                  run(() => setupApproveDeviceAction(phone.id))
                }}
              >
                {busy}Approve
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() => {
                  onStay()
                  run(() => setupDeclineDeviceAction(phone.id))
                }}
              >
                Not this phone
              </Button>
            </div>
          ))}

          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant={state.connectedPhones.length > 0 ? 'outline' : 'default'}
              disabled={pending}
              onClick={() => {
                onStay()
                run(() => setupPairPhoneAction())
              }}
            >
              {busy}
              {state.connectedPhones.length > 0 ? 'Connect another phone' : 'Show pairing code'}
            </Button>
            <span className="text-micro text-muted-foreground">
              {state.pendingPhones.length > 0
                ? 'Approving lets a phone report its SIMs.'
                : 'This checks itself every few seconds once you scan.'}
            </span>
          </div>

          {/*
           * The way out, once at least one phone is through.
           *
           * Deliberately a button rather than the step closing itself. Whoever
           * is doing this is the only one who knows how many handsets are going
           * behind the counter, and the screen guessing "one" was wrong often
           * enough to be the bug.
           */}
          {state.connectedPhones.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2 border-border/60 border-t pt-3">
              <Button size="sm" disabled={pending} onClick={onMoveOn}>
                Done — choose the SIM
              </Button>
              <span className="text-micro text-muted-foreground">
                {state.connectedPhones.length === 1
                  ? 'Or connect another phone first.'
                  : `${state.connectedPhones.length} phones connected. Or connect another first.`}
              </span>
            </div>
          ) : null}
        </div>
      )

    case 'account':
      return <SimPicker state={state} pending={pending} run={run} fields={fields} />

    case 'enable':
      return (
        <Button
          size="sm"
          disabled={pending || !state.firstAccountId}
          onClick={() => run(() => setupEnableAccountAction(state.firstAccountId as string))}
        >
          {busy}Enable the account
        </Button>
      )

    case 'app':
      return (
        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={fields.appName}
            onChange={(e) => fields.setAppName(e.target.value)}
            placeholder="My Shop"
            aria-label="Business name"
            className="h-8 max-w-56 text-small"
          />
          <Button
            size="sm"
            disabled={pending || !fields.appName.trim()}
            onClick={() => run(() => setupCreateAppAction(fields.appName))}
          >
            {busy}Create business
          </Button>
        </div>
      )

    case 'key':
      return (
        <Button
          size="sm"
          disabled={pending || !state.firstAppId}
          onClick={() => run(() => setupCreateKeyAction(state.firstAppId as string))}
        >
          {busy}Generate live key
        </Button>
      )

    case 'endpoint':
      return (
        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={fields.endpointUrl}
            onChange={(e) => fields.setEndpointUrl(e.target.value)}
            placeholder="https://yourshop.com/webhooks/jomma"
            aria-label="Webhook URL"
            className="h-8 max-w-80 text-small"
          />
          <Button
            size="sm"
            disabled={pending || !state.firstAppId || !fields.endpointUrl.trim()}
            onClick={() =>
              run(() => setupAddEndpointAction(state.firstAppId as string, fields.endpointUrl))
            }
          >
            {busy}Save endpoint
          </Button>
        </div>
      )

    default:
      return null
  }
}

/**
 * Shown once, and said so.
 *
 * API keys and signing secrets are hashed at rest and a provisioning QR is
 * burned on use, so this is genuinely the only time any of them is visible.
 */
/**
 * How long is left, ticking, rather than the wall-clock time it dies.
 *
 * "It expires 1:09:44 AM" makes the reader do arithmetic against a clock they
 * have to go and find, while holding a phone up to the screen. A pairing code
 * lasts fifteen minutes and the only question is whether there is time to walk
 * to the till.
 *
 * Starts at null and fills in on mount. Computing it during render would make
 * the first client render disagree with the server's — the same hydration
 * mismatch the pay page's countdown had — and this one sits inside a card that
 * appears after a server action, so the two are a round trip apart.
 */
function Countdown({ until }: { until?: string }) {
  const [left, setLeft] = useState<number | null>(null)

  useEffect(() => {
    if (!until) return
    const tick = () => setLeft(Date.parse(until) - Date.now())
    tick()
    const timer = setInterval(tick, 1000)
    return () => clearInterval(timer)
  }, [until])

  if (!until) return <>It expires shortly.</>
  if (left === null) return null
  if (left <= 0) return <>It has expired — show a new one.</>

  const total = Math.floor(left / 1000)
  const minutes = Math.floor(total / 60)
  const seconds = String(total % 60).padStart(2, '0')

  return (
    <>
      Expires in {minutes}:{seconds}.
    </>
  )
}

function SecretCard({
  secret,
  onDismiss,
}: {
  secret: NonNullable<SetupResult['secret']>
  onDismiss: () => void
}) {
  const [copied, setCopied] = useState(false)

  return (
    <div className="mt-5 rounded-xl border border-pending/40 bg-pending-subtle p-4 text-pending-subtle-foreground">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium text-small">{secret.label}</p>
          <p className="mt-0.5 text-micro opacity-90">
            {secret.kind === 'qr' ? (
              <>
                Scan it from the Jomma app. <Countdown until={secret.expiresAt} />
              </>
            ) : (
              'Copy it now. It cannot be shown again.'
            )}
          </p>
        </div>
        <button type="button" onClick={onDismiss} className="shrink-0 text-micro underline">
          Dismiss
        </button>
      </div>

      {secret.kind === 'qr' ? (
        // biome-ignore lint/performance/noImgElement: a generated data URL, not an asset
        <img
          src={secret.value}
          alt="Device pairing code"
          className="mt-3 size-48 rounded-lg bg-white p-2"
        />
      ) : (
        <div className="mt-3 flex items-center gap-2">
          <code className="figure min-w-0 flex-1 truncate rounded-lg bg-background/70 px-3 py-2 text-micro">
            {secret.value}
          </code>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              void navigator.clipboard.writeText(secret.value).then(
                () => {
                  setCopied(true)
                  setTimeout(() => setCopied(false), 1600)
                },
                () => setCopied(false),
              )
            }}
          >
            {copied ? 'Copied' : 'Copy'}
          </Button>
        </div>
      )}
    </div>
  )
}
