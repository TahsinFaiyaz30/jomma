'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import {
  acknowledgeAlertAction,
  addAccountAction,
  addDeviceAction,
  revokeDeviceAction,
  rotateTokenAction,
  setAccountStatusAction,
} from '@/app/(dash)/accounts/actions'
import { StatusDot } from '@/components/status'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { Spinner } from '@/components/ui/spinner'
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
  const [deviceName, setDeviceName] = useState('')
  const [reveal, setReveal] = useState<
    { kind: 'qr'; dataUrl: string; expiresAt: string } | { kind: 'token'; value: string } | null
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
            />
          ))
        )}

        <div className="flex items-center gap-2 pt-1">
          <Input
            value={deviceName}
            onChange={(event) => setDeviceName(event.target.value)}
            placeholder="New device name"
            className="h-7 max-w-56 text-small"
          />
          <Button
            size="sm"
            variant="outline"
            disabled={pending || !deviceName.trim()}
            onClick={() =>
              run(async () => {
                const result = await addDeviceAction(account.id, deviceName)
                if (result.ok) setDeviceName('')
                return result
              })
            }
          >
            {pending ? <Spinner /> : null}
            Add device
          </Button>
        </div>
      </div>

      {reveal ? <RevealPanel reveal={reveal} onDismiss={() => setReveal(null)} /> : null}
    </section>
  )
}

function DeviceRowView({
  device,
  pending,
  elapsed,
  onRotate,
  onRevoke,
}: {
  device: DeviceRow
  pending: boolean
  elapsed: (from: string) => string
  onRotate: () => void
  onRevoke: () => void
}) {
  const tone =
    device.status === 'revoked'
      ? 'neutral'
      : device.status === 'pending'
        ? 'ambiguous'
        : device.lastHeartbeatAt && Date.now() - Date.parse(device.lastHeartbeatAt) > 15 * 60_000
          ? 'offline'
          : 'matched'

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-border bg-card px-3 py-2">
      <StatusDot tone={tone} />
      <span className="text-small">{device.name}</span>
      <span className="text-micro text-muted-foreground">{device.status}</span>

      {device.status === 'pending' ? (
        <span className="text-micro text-ambiguous-subtle-foreground">
          waiting for the QR to be scanned
        </span>
      ) : (
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
            <span className="text-micro text-ambiguous-subtle-foreground">
              queue {device.queueDepth}
            </span>
          ) : null}
          {device.appVersion ? (
            <span className="figure text-micro text-muted-foreground">v{device.appVersion}</span>
          ) : null}
        </>
      )}

      <span className="ml-auto flex gap-1">
        {device.status !== 'revoked' ? (
          <>
            <Button size="sm" variant="ghost" disabled={pending} onClick={onRotate}>
              Rotate token
            </Button>
            <Button size="sm" variant="ghost" disabled={pending} onClick={onRevoke}>
              Revoke
            </Button>
          </>
        ) : (
          <span className="text-micro text-muted-foreground">re-provision to use again</span>
        )}
      </span>
    </div>
  )
}

/** Shown once. Closing it is the only way to dismiss — no second chance to copy. */
function RevealPanel({
  reveal,
  onDismiss,
}: {
  reveal: { kind: 'qr'; dataUrl: string; expiresAt: string } | { kind: 'token'; value: string }
  onDismiss: () => void
}) {
  return (
    <div className="border-border border-t bg-card px-4 py-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 space-y-2">
          <div className="text-small font-medium">
            {reveal.kind === 'qr' ? 'Scan this from the notifier app' : 'New device token'}
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
              <p className="text-micro text-muted-foreground">
                Expires {new Date(reveal.expiresAt).toLocaleTimeString()}. One scan only.
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
