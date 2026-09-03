'use client'

import { Alert02Icon, SmartPhone01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { StatusDot } from '@/components/status'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { maskMsisdn } from '@/lib/i18n/format'
import { useI18n } from '@/lib/i18n/provider'
import type { StatusTone } from '@/lib/status'
import { UTILIZATION_STOP, UTILIZATION_WARN } from '@/lib/thresholds'
import { cn } from '@/lib/utils'

export interface AccountFooterItem {
  id: string
  provider: 'bkash' | 'nagad'
  msisdn: string
  label: string
  status: 'active' | 'degraded' | 'disabled'
  lastHeartbeatAt: string | null
  lastCaptureAt: string | null
  heartbeatStale: boolean
  balanceDrift: boolean
  routable: boolean
  utilization: number
  openAlerts: number
}

const PROVIDER_LABEL: Record<string, string> = {
  bkash: 'bKash',
  nagad: 'Nagad',
}

/**
 * Account health, permanently visible in the sidebar footer.
 *
 * Not on a settings page. If a device goes down while you are looking at the
 * queue, you should see it without navigating — docs/design.md calls this the
 * single most important layout decision in the product.
 */
export function AccountHealthFooter({ accounts }: { accounts: AccountFooterItem[] }) {
  const { t } = useI18n()

  if (accounts.length === 0) {
    return (
      <div className="px-2 py-3 text-micro text-sidebar-foreground/60">
        No receiving accounts configured.
      </div>
    )
  }

  return (
    <section className="space-y-0.5" aria-label={t('account.health')}>
      {accounts.map((account) => (
        <AccountRow key={account.id} account={account} />
      ))}
    </section>
  )
}

function toneFor(account: AccountFooterItem): StatusTone {
  if (account.status === 'disabled' || account.heartbeatStale || account.balanceDrift) {
    return 'offline'
  }
  if (account.status === 'degraded' || account.utilization >= UTILIZATION_WARN) return 'ambiguous'
  return 'matched'
}

function summaryFor(account: AccountFooterItem, elapsed: (from: string) => string): string {
  if (account.status === 'disabled') return 'disabled'
  if (account.heartbeatStale) {
    return account.lastHeartbeatAt ? `no beat ${elapsed(account.lastHeartbeatAt)}` : 'never seen'
  }
  if (account.balanceDrift) return 'balance drift'
  if (account.utilization >= UTILIZATION_STOP) return 'limit reached'
  if (account.utilization >= UTILIZATION_WARN) return 'near limit'
  return 'ok'
}

function AccountRow({ account }: { account: AccountFooterItem }) {
  const { t, elapsed, percent } = useI18n()
  const tone = toneFor(account)
  const summary = summaryFor(account, (from) => elapsed(from))

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          // Two lines rather than one: at sidebar width a status like
          // "no beat 14h 15m" and an 11-digit number cannot share a row without
          // truncating the thing you actually need to read.
          <div className="w-full rounded-md px-2 py-1 text-left hover:bg-sidebar-accent">
            <div className="flex items-center gap-1.5">
              <StatusDot tone={tone} pulse={tone === 'offline'} />
              <span className="min-w-0 flex-1 truncate text-small text-sidebar-foreground">
                {PROVIDER_LABEL[account.provider] ?? account.provider}
              </span>
              {account.openAlerts > 0 ? (
                <HugeiconsIcon
                  icon={Alert02Icon}
                  strokeWidth={2}
                  className="size-3 shrink-0 text-offline"
                />
              ) : null}
            </div>
            <div className="flex items-baseline gap-2 pl-3">
              <span className="figure shrink-0 text-micro text-sidebar-foreground/50">
                {maskMsisdn(account.msisdn)}
              </span>
              <span
                className={cn(
                  'min-w-0 flex-1 truncate text-right text-micro',
                  tone === 'offline'
                    ? 'text-offline'
                    : tone === 'ambiguous'
                      ? 'text-ambiguous'
                      : 'text-sidebar-foreground/50',
                )}
              >
                {summary}
              </span>
            </div>
          </div>
        }
      />
      <TooltipContent side="right" className="max-w-64">
        <div className="space-y-1 text-micro">
          <div className="font-medium">{account.label}</div>
          <div className="figure">{account.msisdn}</div>
          <dl className="space-y-0.5 pt-1">
            <Row
              label={t('account.lastHeartbeat')}
              value={account.lastHeartbeatAt ? elapsed(account.lastHeartbeatAt) : '—'}
            />
            <Row
              label={t('account.lastCapture')}
              value={account.lastCaptureAt ? elapsed(account.lastCaptureAt) : '—'}
            />
            <Row label={t('account.utilization')} value={percent(account.utilization)} />
            {account.balanceDrift ? <Row label={t('account.balanceDrift')} value="yes" /> : null}
          </dl>
          {account.openAlerts > 0 ? (
            <div className="flex items-center gap-1 pt-1 text-offline">
              <HugeiconsIcon icon={SmartPhone01Icon} strokeWidth={2} className="size-3" />
              {account.openAlerts} open alert
              {account.openAlerts === 1 ? '' : 's'}
            </div>
          ) : null}
        </div>
      </TooltipContent>
    </Tooltip>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="opacity-70">{label}</dt>
      <dd className="figure">{value}</dd>
    </div>
  )
}
