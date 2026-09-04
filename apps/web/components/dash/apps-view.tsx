'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import {
  createEndpointAction,
  createKeyAction,
  replayAllFailedAction,
  replayDeliveryAction,
  revokeKeyAction,
  setRedirectHostsAction,
  toggleEndpointAction,
} from '@/app/(dash)/apps/actions'
import { StatusDot } from '@/components/status'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { Spinner } from '@/components/ui/spinner'
import { useI18n } from '@/lib/i18n/provider'
import type { AppView } from '@/lib/services/app-admin'
import { cn } from '@/lib/utils'

export function AppsView({ apps }: { apps: AppView[] }) {
  return (
    <div className="min-h-0 flex-1 space-y-6 overflow-auto p-6">
      {apps.map((app) => (
        <AppCard key={app.id} app={app} />
      ))}
    </div>
  )
}

function AppCard({ app }: { app: AppView }) {
  const { elapsed, dateTime } = useI18n()
  const [pending, startTransition] = useTransition()
  const [keyName, setKeyName] = useState('')
  const [endpointUrl, setEndpointUrl] = useState('')
  const [secret, setSecret] = useState<{ label: string; value: string } | null>(null)

  const run = (fn: () => Promise<{ ok: boolean; message: string; secret?: typeof secret }>) =>
    startTransition(async () => {
      const result = await fn()
      if (result.ok) {
        toast.success(result.message)
        if (result.secret) setSecret(result.secret)
      } else {
        toast.error(result.message)
      }
    })

  return (
    <section className="rounded-lg border border-border">
      <header className="flex items-center gap-3 border-border border-b px-4 py-3">
        <div className="min-w-0">
          <div className="text-title font-medium">{app.name}</div>
          <div className="figure text-small text-muted-foreground">{app.slug}</div>
        </div>
        <div className="ml-auto flex gap-3 text-micro text-muted-foreground">
          <span>{app.deliveryCounts.delivered} delivered</span>
          {app.deliveryCounts.pending > 0 ? (
            <span className="text-pending-subtle-foreground">
              {app.deliveryCounts.pending} pending
            </span>
          ) : null}
          {app.deliveryCounts.failed > 0 ? (
            <span className="text-offline-subtle-foreground">
              {app.deliveryCounts.failed} failed
            </span>
          ) : null}
        </div>
      </header>

      {/* ── API keys ───────────────────────────────────────────────────── */}
      <div className="space-y-2 px-4 py-3">
        <div className="text-small font-medium">API keys</div>
        {app.keys.map((key) => (
          <div
            key={key.id}
            className={cn(
              'flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-border bg-card px-3 py-2',
              key.status !== 'active' && 'opacity-60',
            )}
          >
            <StatusDot tone={key.status === 'active' ? 'matched' : 'neutral'} />
            <span className="text-small">{key.name}</span>
            {/* Only the prefix is stored in clear — this is all anyone can ever see again. */}
            <span className="figure text-small text-muted-foreground">
              {key.prefix}…{key.lastFour}
            </span>
            <span className="text-micro text-muted-foreground">{key.environment}</span>
            <span className="text-micro text-muted-foreground">
              {key.lastUsedAt ? `used ${elapsed(key.lastUsedAt)}` : 'never used'}
            </span>
            <span className="ml-auto">
              {key.status === 'active' ? (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={pending}
                  onClick={() => run(() => revokeKeyAction(key.id))}
                >
                  Revoke
                </Button>
              ) : (
                <span className="text-micro text-muted-foreground">revoked</span>
              )}
            </span>
          </div>
        ))}

        <div className="flex items-center gap-2 pt-1">
          <Input
            value={keyName}
            onChange={(event) => setKeyName(event.target.value)}
            placeholder="Key name"
            className="h-7 max-w-48 text-small"
          />
          <Button
            size="sm"
            variant="outline"
            disabled={pending || !keyName.trim()}
            onClick={() =>
              run(async () => {
                const result = await createKeyAction(app.id, keyName, 'live')
                if (result.ok) setKeyName('')
                return result
              })
            }
          >
            {pending ? <Spinner /> : null}
            Create live key
          </Button>
        </div>
      </div>

      <Separator />

      {/* ── Hosted checkout ────────────────────────────────────────────── */}
      <RedirectHosts app={app} />

      <Separator />

      {/* ── Webhook endpoints ──────────────────────────────────────────── */}
      <div className="space-y-2 px-4 py-3">
        <div className="text-small font-medium">Webhook endpoints</div>
        {app.endpoints.length === 0 ? (
          <p className="text-small text-muted-foreground">
            No endpoints. Nothing will be told when a payment arrives.
          </p>
        ) : (
          app.endpoints.map((endpoint) => (
            <div
              key={endpoint.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-border bg-card px-3 py-2"
            >
              <StatusDot tone={endpoint.status === 'active' ? 'matched' : 'neutral'} />
              <span className="figure min-w-0 flex-1 truncate text-small">{endpoint.url}</span>
              <span className="text-micro text-muted-foreground">
                {endpoint.enabledEvents.length} events
              </span>
              <Button
                size="sm"
                variant="ghost"
                disabled={pending}
                onClick={() =>
                  run(() =>
                    toggleEndpointAction(
                      endpoint.id,
                      endpoint.status === 'active' ? 'disabled' : 'active',
                    ),
                  )
                }
              >
                {endpoint.status === 'active' ? 'Disable' : 'Enable'}
              </Button>
            </div>
          ))
        )}

        <div className="flex items-center gap-2 pt-1">
          <Input
            value={endpointUrl}
            onChange={(event) => setEndpointUrl(event.target.value)}
            placeholder="https://example.com/webhooks/jomma"
            className="h-7 max-w-80 text-small"
          />
          <Button
            size="sm"
            variant="outline"
            disabled={pending || !endpointUrl.trim()}
            onClick={() =>
              run(async () => {
                const result = await createEndpointAction(app.id, endpointUrl)
                if (result.ok) setEndpointUrl('')
                return result
              })
            }
          >
            Add endpoint
          </Button>
        </div>
      </div>

      <Separator />

      {/* ── Delivery log ───────────────────────────────────────────────── */}
      <div className="space-y-2 px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="text-small font-medium">Delivery log</div>
          {app.deliveryCounts.failed > 0 ? (
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => run(() => replayAllFailedAction(app.id))}
            >
              Replay all failed ({app.deliveryCounts.failed})
            </Button>
          ) : null}
        </div>

        {app.deliveries.length === 0 ? (
          <p className="text-small text-muted-foreground">Nothing delivered yet.</p>
        ) : (
          <div className="overflow-hidden rounded-md border border-border">
            {app.deliveries.slice(0, 25).map((delivery) => {
              const tone =
                delivery.status === 'delivered'
                  ? 'matched'
                  : delivery.status === 'failed'
                    ? 'offline'
                    : 'pending'

              return (
                <div
                  key={delivery.id}
                  className="flex flex-wrap items-center gap-x-3 gap-y-0.5 border-border/50 border-b px-3 py-1.5 last:border-b-0"
                >
                  <StatusDot tone={tone} />
                  <span className="figure w-[150px] shrink-0 text-small">{delivery.eventType}</span>
                  <span className="figure hidden w-[180px] shrink-0 truncate text-micro text-muted-foreground lg:block">
                    {delivery.eventId}
                  </span>
                  <span className="text-micro text-muted-foreground">
                    {delivery.attempts} attempt{delivery.attempts === 1 ? '' : 's'}
                  </span>
                  {delivery.lastStatusCode ? (
                    <span className="figure text-micro text-muted-foreground">
                      HTTP {delivery.lastStatusCode}
                    </span>
                  ) : null}
                  {delivery.lastError ? (
                    <span className="min-w-0 flex-1 truncate text-micro text-offline-subtle-foreground">
                      {delivery.lastError}
                    </span>
                  ) : (
                    <span className="min-w-0 flex-1" />
                  )}
                  <span className="text-micro text-muted-foreground">
                    {delivery.deliveredAt
                      ? dateTime(delivery.deliveredAt)
                      : delivery.nextAttemptAt
                        ? `retry ${elapsed(delivery.nextAttemptAt)}`
                        : '—'}
                  </span>
                  {delivery.status !== 'delivered' ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={pending}
                      onClick={() => run(() => replayDeliveryAction(delivery.id))}
                    >
                      Replay
                    </Button>
                  ) : null}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {secret ? (
        <div className="border-border border-t bg-card px-4 py-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 space-y-1">
              <div className="text-small font-medium">{secret.label}</div>
              <code className="figure block max-w-full overflow-x-auto rounded-md bg-muted px-3 py-2 text-small">
                {secret.value}
              </code>
              <p className="text-micro text-muted-foreground">
                Shown once. It is hashed at rest and cannot be recovered.
              </p>
            </div>
            <Button size="sm" variant="outline" onClick={() => setSecret(null)}>
              Done
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  )
}

/**
 * Where the hosted pay page may return a buyer.
 *
 * Empty means no redirect, which is the safe default and the state every app
 * starts in — an unchecked return URL on a payment page is an open redirect
 * pointed at somebody who has just been told to trust the page.
 */
function RedirectHosts({ app }: { app: AppView }) {
  const [value, setValue] = useState(app.allowedRedirectHosts.join(', '))
  const [pending, start] = useTransition()

  return (
    <div className="space-y-2 px-4 py-3">
      <div className="text-small font-medium">Hosted checkout</div>
      <p className="max-w-2xl text-micro text-muted-foreground">
        Send buyers to <span className="figure">/pay/&lt;intent_id&gt;</span> and pass a{' '}
        <span className="figure">return_url</span> when creating the intent. Only these hostnames
        are ever followed; subdomains of each are included. Leave empty and no redirect is offered
        at all.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="shop.example.com, checkout.example.com"
          className="h-7 max-w-md text-small"
        />
        <Button
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const result = await setRedirectHostsAction(app.id, value)
              if (result.ok) toast.success(result.message)
              else toast.error(result.message)
            })
          }
        >
          {pending ? <Spinner /> : null}
          Save
        </Button>
      </div>
    </div>
  )
}
