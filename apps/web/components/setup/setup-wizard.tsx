'use client'

import { useEffect, useState, useTransition } from 'react'
import { toast } from 'sonner'
import {
  refreshSetupAction,
  type SetupResult,
  setupAddAccountAction,
  setupAddDeviceAction,
  setupAddEndpointAction,
  setupCreateAppAction,
  setupCreateKeyAction,
  setupEnableAccountAction,
} from '@/app/setup/actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import type { SetupState, SetupStepId } from '@/lib/services/onboarding'

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

const HINT: Record<SetupStepId, string> = {
  account: 'Use the number that will actually receive money. It cannot be changed later.',
  device: 'Install the Jomma app on the phone holding that SIM, then scan this code.',
  enable: 'Only once the phone is connected — an enabled account is live to buyers.',
  app: 'The storefront you are taking payments for.',
  key: 'Your server sends this with every request. Store it somewhere safe.',
  endpoint: 'Where Jomma POSTs when a payment lands. Skip it if you would rather poll.',
}

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
   * The device step is the only one that completes off-screen: somebody walks
   * to a phone and scans a code. Poll while that is the open step so the wizard
   * moves on by itself instead of leaving them wondering whether it worked.
   */
  useEffect(() => {
    if (state.currentStepId !== 'device') return
    const timer = setInterval(() => {
      startTransition(async () => setState((await refreshSetupAction()).state))
    }, 4000)
    return () => clearInterval(timer)
  }, [state.currentStepId])

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
        {state.steps.map((step, index) => {
          const isCurrent = step.id === state.currentStepId
          const locked = !step.done && !isCurrent

          return (
            <li
              key={step.id}
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
                      <p className="mb-2 text-micro text-muted-foreground">{HINT[step.id]}</p>
                      <StepForm
                        step={step.id}
                        state={state}
                        pending={pending}
                        run={run}
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
                    </div>
                  ) : null}
                </div>
              </div>
            </li>
          )
        })}
      </ol>

      {secret ? <SecretCard secret={secret} onDismiss={() => setSecret(null)} /> : null}

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

function StepForm({
  step,
  state,
  pending,
  run,
  fields,
}: {
  step: SetupStepId
  state: SetupState
  pending: boolean
  run: (fn: () => Promise<SetupResult>) => void
  fields: Fields
}) {
  const busy = pending ? <Spinner /> : null

  switch (step) {
    case 'account':
      return (
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
          <Input
            value={fields.msisdn}
            onChange={(e) => fields.setMsisdn(e.target.value)}
            placeholder="01712345678"
            aria-label="Receiving number"
            className="figure h-8 max-w-44 text-small"
          />
          <Input
            value={fields.label}
            onChange={(e) => fields.setLabel(e.target.value)}
            placeholder="Shop bKash"
            aria-label="Label"
            className="h-8 max-w-44 text-small"
          />
          <Button
            size="sm"
            disabled={pending || !fields.msisdnValid || !fields.label.trim()}
            onClick={() =>
              run(() => setupAddAccountAction(fields.provider, fields.msisdn, fields.label))
            }
          >
            {busy}Add number
          </Button>
        </div>
      )

    case 'device':
      return (
        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={fields.deviceName}
            onChange={(e) => fields.setDeviceName(e.target.value)}
            placeholder="Shop phone"
            aria-label="Phone name"
            className="h-8 max-w-44 text-small"
          />
          <Button
            size="sm"
            disabled={pending || !state.firstAccountId || !fields.deviceName.trim()}
            onClick={() =>
              run(() => setupAddDeviceAction(state.firstAccountId as string, fields.deviceName))
            }
          >
            {busy}Show pairing code
          </Button>
          <span className="text-micro text-muted-foreground">
            This checks itself every few seconds once you scan.
          </span>
        </div>
      )

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
            {secret.kind === 'qr'
              ? `Scan it from the Jomma app. It expires ${
                  secret.expiresAt ? new Date(secret.expiresAt).toLocaleTimeString() : 'shortly'
                }.`
              : 'Copy it now. It cannot be shown again.'}
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
