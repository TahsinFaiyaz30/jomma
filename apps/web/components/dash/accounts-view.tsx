'use client'

import type { CaptureSettings } from '@jomma/shared'
import { useId, useState, useTransition } from 'react'
import { toast } from 'sonner'
import {
  acknowledgeAlertAction,
  addAccountAction,
  addDeviceAction,
  approveDeviceAction,
  renameDeviceAction,
  revokeDeviceAction,
  rotateTokenAction,
  setAccountStatusAction,
  setCaptureSettingsAction,
} from '@/app/(dash)/accounts/actions'
import { StatusDot } from '@/components/status'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { Spinner } from '@/components/ui/spinner'
import { Switch } from '@/components/ui/switch'
import { formatMsisdn } from '@/lib/i18n/format'
import { useI18n } from '@/lib/i18n/provider'
import type { DeviceRow } from '@/lib/services/devices'
import { UTILIZATION_STOP, UTILIZATION_WARN } from '@/lib/thresholds'
import { cn } from '@/lib/utils'

export interface AccountView {
  id: string
  provider: 'bkash' | 'nagad'
  msisdn: string
  label: string
  status: 'active' | 'degraded' | 'disabled'
  statusReason: string | null
  heartbeatStale: boolean
  balanceDrift: boolean
  balanceDriftCents: number | null
  routable: boolean
  lastHeartbeatAt: string | null
  lastCaptureAt: string | null
  lastKnownBalanceCents: number | null
  dailyUsedCents: number
  dailyLimitCents: number
  monthlyUsedCents: number
  monthlyLimitCents: number
  utilization: number
  capture: CaptureSettings
  devices: DeviceRow[]
  alerts: Array<{
    id: string
    kind: string
    severity: string
    detail: string | null
    createdAt: string
  }>
}

export function AccountsView({ accounts }: { accounts: AccountView[] }) {
  return (
    <div className="min-h-0 flex-1 space-y-6 overflow-auto p-6">
      <NewAccount firstOne={accounts.length === 0} />
      {accounts.map((account) => (
        <AccountCard key={account.id} account={account} />
      ))}
    </div>
  )
}

/**
 * Adding a number for Jomma to watch.
 *
 * Created disabled, and the copy says so. An active account is immediately
 * eligible for checkout routing, so enabling one before a phone is watching it
 * would send a buyer to a number nobody can see pay into.
 */
function NewAccount({ firstOne }: { firstOne: boolean }) {
  const [pending, startTransition] = useTransition()
  const [provider, setProvider] = useState<'bkash' | 'nagad'>('bkash')
  const [msisdn, setMsisdn] = useState('')
  const [label, setLabel] = useState('')

  const digits = msisdn.replace(/\D/g, '')
  const valid = /^(880)?1[3-9]\d{8}$/.test(digits.startsWith('0') ? digits.slice(1) : digits)

  const submit = () =>
    startTransition(async () => {
      const result = await addAccountAction(provider, msisdn, label)
      if (result.ok) {
        setMsisdn('')
        setLabel('')
        toast.success(result.message)
      } else {
        toast.error(result.message)
      }
    })

  return (
    <div className="rounded-xl border border-border p-4">
      <h2 className="font-medium text-title">
        {firstOne ? 'Add your first receiving account' : 'New receiving account'}
      </h2>
      <p className="mt-1 max-w-prose text-micro text-muted-foreground">
        The number buyers send money to. It is added <strong>disabled</strong> — provision a phone
        for it below, then enable it, so checkout never routes a buyer to a number nobody is
        watching.
      </p>

      <div className="flex flex-wrap items-center gap-2 pt-3">
        <select
          value={provider}
          onChange={(event) => setProvider(event.target.value as 'bkash' | 'nagad')}
          className="h-7 rounded-md border border-border bg-background px-2 text-small"
          aria-label="Provider"
        >
          <option value="bkash">bKash</option>
          {/* Selectable so an account can be recorded ahead of the parser, but
              checkout will not route to it until lib/parsers/nagad.ts is real. */}
          <option value="nagad">Nagad (no parser yet)</option>
        </select>

        <Input
          value={msisdn}
          onChange={(event) => setMsisdn(event.target.value)}
          placeholder="01712345678"
          aria-label="Receiving number"
          aria-invalid={msisdn.length > 0 && !valid}
          className="figure h-7 max-w-44 text-small"
        />

        <Input
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && valid && label.trim()) submit()
          }}
          placeholder="Shop bKash"
          aria-label="Label"
          className="h-7 max-w-48 text-small"
        />

        <Button
          size="sm"
          variant="outline"
          disabled={pending || !valid || !label.trim()}
          onClick={submit}
        >
          {pending ? <Spinner /> : null}
          Add account
        </Button>
      </div>

      {msisdn.length > 0 && !valid ? (
        <p className="pt-2 text-micro text-muted-foreground">
          Eleven digits starting 01, or the same number written 8801…
        </p>
      ) : null}
    </div>
  )
}

function AccountCard({ account }: { account: AccountView }) {
  const { amount, elapsed, percent } = useI18n()
  const [pending, startTransition] = useTransition()
  const [reveal, setReveal] = useState<
    | { kind: 'qr'; dataUrl: string; expiresAt: string; appLinksReady: boolean }
    | { kind: 'token'; value: string }
    | null
  >(null)

  const tone = !account.routable
    ? account.status === 'disabled'
      ? 'neutral'
      : 'offline'
    : account.utilization >= UTILIZATION_WARN
      ? 'ambiguous'
      : 'matched'

  const run = (fn: () => Promise<{ ok: boolean; message: string; secret?: typeof reveal }>) =>
    startTransition(async () => {
      const result = await fn()
      if (result.ok) {
        toast.success(result.message)
        if (result.secret) setReveal(result.secret)
      } else {
        toast.error(result.message)
      }
    })

  return (
    <section className="rounded-lg border border-border">
      <header className="flex flex-wrap items-center gap-3 border-border border-b px-4 py-3">
        <StatusDot tone={tone} pulse={tone === 'offline'} />
        <div className="min-w-0">
          <div className="text-title font-medium">{account.label}</div>
          <div className="figure text-small text-muted-foreground">
            {formatMsisdn(account.msisdn)} · {account.provider === 'bkash' ? 'bKash' : 'Nagad'}
          </div>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <span className="text-small text-muted-foreground">
            {account.routable ? 'accepting payments' : 'not routable'}
          </span>
          <Button
            size="sm"
            variant={account.status === 'disabled' ? 'outline' : 'ghost'}
            disabled={pending}
            onClick={() =>
              run(() =>
                setAccountStatusAction(
                  account.id,
                  account.status === 'disabled' ? 'active' : 'disabled',
                ),
              )
            }
          >
            {account.status === 'disabled' ? 'Enable' : 'Disable'}
          </Button>
        </div>
      </header>

      {account.statusReason ? (
        <p className="border-border border-b bg-offline-subtle px-4 py-2 text-small text-offline-subtle-foreground">
          {account.statusReason}
        </p>
      ) : null}

      <div className="grid gap-4 px-4 py-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric
          label="Last heartbeat"
          value={account.lastHeartbeatAt ? elapsed(account.lastHeartbeatAt) : 'never'}
          warn={account.heartbeatStale}
        />
        <Metric
          label="Last capture"
          value={account.lastCaptureAt ? elapsed(account.lastCaptureAt) : 'never'}
        />
        <Metric
          label="Known balance"
          value={
            account.lastKnownBalanceCents === null ? '—' : amount(account.lastKnownBalanceCents)
          }
          warn={account.balanceDrift}
        />
        <Metric
          label="Devices"
          value={String(account.devices.filter((d) => d.status === 'active').length)}
        />
      </div>

      <div className="space-y-2 px-4 pb-3">
        <Utilisation
          label="Daily"
          used={account.dailyUsedCents}
          limit={account.dailyLimitCents}
          format={amount}
          percent={percent}
        />
        <Utilisation
          label="Monthly"
          used={account.monthlyUsedCents}
          limit={account.monthlyLimitCents}
          format={amount}
          percent={percent}
        />
      </div>

      {account.alerts.length > 0 ? (
        <>
          <Separator />
          <div className="space-y-1.5 px-4 py-3">
            <div className="text-small font-medium">Open alerts</div>
            {account.alerts.map((alert) => (
              <div key={alert.id} className="flex items-center gap-2 text-small">
                <StatusDot tone={alert.severity === 'critical' ? 'offline' : 'ambiguous'} />
                <span className="figure text-micro">{alert.kind}</span>
                <span className="min-w-0 flex-1 truncate text-muted-foreground">
                  {alert.detail ?? '—'}
                </span>
                <span className="text-micro text-muted-foreground">{elapsed(alert.createdAt)}</span>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={pending}
                  onClick={() => run(() => acknowledgeAlertAction(alert.id))}
                >
                  Acknowledge
                </Button>
              </div>
            ))}
          </div>
        </>
      ) : null}

      <Separator />

      <CapturePanel accountId={account.id} saved={account.capture} />

      <Separator />

      <div className="space-y-2 px-4 py-3">
        <div className="text-small font-medium">Devices</div>

        {account.devices.length === 0 ? (
          <p className="text-small text-muted-foreground">
            No devices. An account with no phone captures nothing.
          </p>
        ) : (
          account.devices.map((device) => (
            <DeviceRowView
              key={device.id}
              device={device}
              pending={pending}
              elapsed={elapsed}
              onRotate={() => run(() => rotateTokenAction(device.id))}
              onRevoke={() => run(() => revokeDeviceAction(device.id))}
              onApprove={() => run(() => approveDeviceAction(device.id))}
              onRename={(name) => run(() => renameDeviceAction(device.id, name))}
            />
          ))
        )}

        {/*
          One button, no form. Naming the phone here was a required field
          standing between the operator and the only thing this control exists
          to produce — and a name guessed before meeting the device is worse
          than the model the phone reports for itself when it pairs. Rename it
          afterwards, when it is in front of you.
        */}
        <div className="flex items-center gap-2 pt-1">
          <Button
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => run(() => addDeviceAction(account.id))}
          >
            {pending ? <Spinner /> : null}
            Pair a phone
          </Button>
          <span className="text-micro text-muted-foreground">
            Shows a QR. The phone names itself when it scans.
          </span>
        </div>
      </div>

      {reveal ? <RevealPanel reveal={reveal} onDismiss={() => setReveal(null)} /> : null}
    </section>
  )
}

/**
 * What to keep out of this number's feed.
 *
 * The same three switches are in the notifier app and write to the same row, so
 * whichever screen is closer to hand wins. The phone picks a dashboard change up
 * on its next heartbeat.
 *
 * Incoming Send Money is shown as a fixed row rather than a disabled switch. A
 * greyed-out toggle reads as "not available yet"; a line of text saying it is
 * always kept says the true thing, which is that it is the only type that can
 * settle an order and turning it off would be turning Jomma off.
 */
function CapturePanel({ accountId, saved }: { accountId: string; saved: CaptureSettings }) {
  const [pending, startTransition] = useTransition()
  // Optimistic, so a switch moves under the finger rather than after a
  // round-trip. Reverted from `saved` if the write fails.
  const [draft, setDraft] = useState(saved)

  const toggle = (key: keyof CaptureSettings) => {
    const next = { ...draft, [key]: !draft[key] }
    setDraft(next)
    startTransition(async () => {
      const result = await setCaptureSettingsAction(accountId, next)
      if (!result.ok) {
        setDraft(saved)
        toast.error(result.message)
      }
    })
  }

  return (
    <div className="space-y-2 px-4 py-3">
      <div className="flex items-center gap-2">
        <span className="text-small font-medium">What to capture</span>
        {pending ? <Spinner className="size-3 text-muted-foreground" /> : null}
      </div>
      <p className="max-w-prose text-micro text-muted-foreground">
        The phone forwards everything bKash shows it. Anything switched off here is dropped on
        arrival and never stored. These switches are also in the app — they are the same setting.
      </p>

      <div className="pt-1">
        <div className="flex items-center gap-3 border-border border-b py-2">
          <div className="min-w-0 flex-1">
            <div className="text-small">Incoming Send Money</div>
            <div className="text-micro text-muted-foreground">
              Money buyers send you. The only type that can settle an order.
            </div>
          </div>
          <span className="text-micro text-muted-foreground">always</span>
        </div>

        <CaptureToggle
          label="Cash In"
          hint="Top-ups from an agent or your own bank. Never matched to an order."
          checked={draft.cash_in}
          disabled={pending}
          onChange={() => toggle('cash_in')}
        />
        <CaptureToggle
          label="Money you sent"
          hint="Send Money leaving this number. Keeps a ledger; cannot pay an order."
          checked={draft.outgoing}
          disabled={pending}
          onChange={() => toggle('outgoing')}
        />
        <CaptureToggle
          label="Everything else"
          hint="Promotions, balance notices, offers. Usually noise."
          checked={draft.other}
          disabled={pending}
          onChange={() => toggle('other')}
          last
        />
      </div>

      <p className="text-micro text-muted-foreground">
        A message the parser cannot read is kept whatever these say — it is the evidence needed to
        fix the parser, and its type is unknown precisely because something changed.
      </p>
    </div>
  )
}

function CaptureToggle({
  label,
  hint,
  checked,
  disabled,
  onChange,
  last = false,
}: {
  label: string
  hint: string
  checked: boolean
  disabled: boolean
  onChange: () => void
  last?: boolean
}) {
  const id = useId()

  return (
    <div className={cn('flex items-center gap-3 py-2', !last && 'border-border border-b')}>
      <label htmlFor={id} className="min-w-0 flex-1 cursor-pointer">
        <div className="text-small">{label}</div>
        <div className="text-micro text-muted-foreground">{hint}</div>
      </label>
      <Switch id={id} checked={checked} disabled={disabled} onCheckedChange={onChange} />
    </div>
  )
}

function deviceTone(device: DeviceRow) {
  if (device.status === 'revoked') return 'neutral'
  if (device.status === 'pending' || device.status === 'awaiting_approval') return 'ambiguous'

  const stale =
    device.lastHeartbeatAt && Date.now() - Date.parse(device.lastHeartbeatAt) > 15 * 60_000
  return stale ? 'offline' : 'matched'
}

/** The middle of the row: what this phone is doing, or what it is waiting for. */
function DeviceDetail({
  device,
  elapsed,
}: {
  device: DeviceRow
  elapsed: (from: string) => string
}) {
  if (device.status === 'awaiting_approval') {
    return (
      <span className="text-ambiguous-subtle-foreground text-micro">
        a phone scanned this code — approve it only if you recognise it
      </span>
    )
  }

  if (device.status === 'pending') {
    return (
      <span className="text-ambiguous-subtle-foreground text-micro">
        waiting for the QR to be scanned
      </span>
    )
  }

  return (
    <>
      <span className="text-micro text-muted-foreground">
        beat {device.lastHeartbeatAt ? elapsed(device.lastHeartbeatAt) : 'never'}
      </span>
      {device.battery !== null ? (
        <span className="text-micro text-muted-foreground">
          {device.battery}%{device.charging ? ' charging' : ''}
        </span>
      ) : null}
      {device.queueDepth ? (
        <span className="text-ambiguous-subtle-foreground text-micro">
          queue {device.queueDepth}
        </span>
      ) : null}
      {device.appVersion ? (
        <span className="figure text-micro text-muted-foreground">v{device.appVersion}</span>
      ) : null}
    </>
  )
}

function DeviceActions({
  device,
  pending,
  onRotate,
  onRevoke,
  onApprove,
  onRename,
}: {
  device: DeviceRow
  pending: boolean
  onRotate: () => void
  onRevoke: () => void
  onApprove: () => void
  onRename: (name: string) => void
}) {
  if (device.status === 'awaiting_approval') {
    return (
      <>
        <Button size="sm" disabled={pending} onClick={onApprove}>
          Approve
        </Button>
        {/* Rejecting is revoking: the token was already issued, so refusing has
            to invalidate it rather than merely decline to promote it. */}
        <Button size="sm" variant="ghost" disabled={pending} onClick={onRevoke}>
          Reject
        </Button>
      </>
    )
  }

  if (device.status === 'revoked') {
    return <span className="text-micro text-muted-foreground">re-provision to use again</span>
  }

  return (
    <>
      {/*
        Renaming is offered here rather than at pairing, because this is the
        first moment the phone is actually in front of somebody — it has told
        the dashboard its model, and now it can be called whatever the shop
        calls it. Names are cosmetic and need not be unique.
      */}
      <Button
        size="sm"
        variant="ghost"
        disabled={pending}
        onClick={() => {
          const next = window.prompt('What should this phone be called?', device.name)?.trim()
          if (next && next !== device.name) onRename(next)
        }}
      >
        Rename
      </Button>
      <Button size="sm" variant="ghost" disabled={pending} onClick={onRotate}>
        Rotate token
      </Button>
      <Button size="sm" variant="ghost" disabled={pending} onClick={onRevoke}>
        Revoke
      </Button>
    </>
  )
}

function DeviceRowView({
  device,
  pending,
  elapsed,
  onRotate,
  onRevoke,
  onApprove,
  onRename,
}: {
  device: DeviceRow
  pending: boolean
  elapsed: (from: string) => string
  onRotate: () => void
  onRevoke: () => void
  onApprove: () => void
  onRename: (name: string) => void
}) {
  const awaiting = device.status === 'awaiting_approval'

  return (
    <div
      className={
        // A phone waiting on a decision has to be findable without reading every
        // row, so it gets a border rather than another grey label.
        awaiting
          ? 'flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-ambiguous bg-ambiguous-subtle px-3 py-2'
          : 'flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-border bg-card px-3 py-2'
      }
    >
      <StatusDot tone={deviceTone(device)} />
      <span className="text-small">{device.name}</span>
      <span className="text-micro text-muted-foreground">
        {awaiting ? 'awaiting approval' : device.status}
      </span>

      <DeviceDetail device={device} elapsed={elapsed} />

      <span className="ml-auto flex gap-1">
        <DeviceActions
          device={device}
          pending={pending}
          onRotate={onRotate}
          onRevoke={onRevoke}
          onApprove={onApprove}
          onRename={onRename}
        />
      </span>
    </div>
  )
}

/** Shown once. Closing it is the only way to dismiss — no second chance to copy. */
function RevealPanel({
  reveal,
  onDismiss,
}: {
  reveal:
    | { kind: 'qr'; dataUrl: string; expiresAt: string; appLinksReady: boolean }
    | { kind: 'token'; value: string }
  onDismiss: () => void
}) {
  return (
    <div className="border-border border-t bg-card px-4 py-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 space-y-2">
          <div className="text-small font-medium">
            {reveal.kind === 'qr' ? 'Scan this with the phone' : 'New device token'}
          </div>
          {reveal.kind === 'qr' ? (
            <>
              {/* biome-ignore lint/performance/noImgElement: a data: URL generated
                  per request has nothing for next/image to optimise. */}
              <img
                src={reveal.dataUrl}
                alt="Device provisioning QR code"
                width={220}
                height={220}
                className="rounded-md bg-white p-2"
              />
              {reveal.appLinksReady ? (
                <p className="max-w-56 text-micro text-muted-foreground">
                  Any QR scanner works — the phone's camera app will offer to open it in Jomma. Or
                  use the app's own scanner, which can also read it from a screenshot.
                </p>
              ) : (
                /*
                 * The failure this warning exists for is silent. The QR is
                 * valid and the app is installed; the link just opens a browser,
                 * because Android will not verify a domain that does not name
                 * the app's certificate. Nothing errors anywhere.
                 */
                <p className="max-w-56 text-micro text-ambiguous-subtle-foreground">
                  <strong>Use the app's own scanner for now.</strong> Another scanner will open a
                  browser instead, because <code className="figure">ANDROID_CERT_SHA256</code> is
                  not set on this instance. Run{' '}
                  <code className="figure">gradlew :app:printSigningFingerprint</code> and set what
                  it prints.
                </p>
              )}
              <p className="text-micro text-muted-foreground">
                Expires {new Date(reveal.expiresAt).toLocaleTimeString()}. One scan only.
              </p>
              {/*
                Said here rather than only on the device row, because this is
                where somebody is standing when the phone scans. Without it the
                pairing looks like it failed: the app says it is waiting, the
                dialog said nothing about a second step, and the obvious guess
                is to issue another code.
              */}
              <p className="max-w-56 rounded-md bg-ambiguous-subtle px-2.5 py-2 text-ambiguous-subtle-foreground text-micro">
                Scanning is not the last step. The phone appears below as{' '}
                <strong>awaiting approval</strong> and captures nothing until you approve it — so a
                code that leaks is still not a working device.
              </p>
            </>
          ) : (
            <>
              <code className="figure block max-w-full overflow-x-auto rounded-md bg-muted px-3 py-2 text-small">
                {reveal.value}
              </code>
              <p className="text-micro text-muted-foreground">
                Shown once. The previous token stopped working already.
              </p>
            </>
          )}
        </div>
        <Button size="sm" variant="outline" onClick={onDismiss}>
          Done
        </Button>
      </div>
    </div>
  )
}

function Metric({ label, value, warn = false }: { label: string; value: string; warn?: boolean }) {
  return (
    <div>
      <div className="text-micro text-muted-foreground">{label}</div>
      <div className={cn('text-small', warn && 'text-offline-subtle-foreground')}>{value}</div>
    </div>
  )
}

function Utilisation({
  label,
  used,
  limit,
  format,
  percent,
}: {
  label: string
  used: number
  limit: number
  format: (poisha: number) => string
  percent: (fraction: number) => string
}) {
  const fraction = limit > 0 ? Math.min(used / limit, 1) : 0
  // Warn at 80%, stop routing at 95% — the thresholds routing actually uses.
  const tone =
    fraction >= UTILIZATION_STOP
      ? 'bg-offline'
      : fraction >= UTILIZATION_WARN
        ? 'bg-ambiguous'
        : 'bg-matched'

  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between text-micro">
        <span className="text-muted-foreground">{label} limit</span>
        <span className="amount">
          {format(used)} / {format(limit)} · {percent(fraction)}
        </span>
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-muted">
        <div className={cn('h-full rounded-full', tone)} style={{ width: `${fraction * 100}%` }} />
      </div>
    </div>
  )
}
