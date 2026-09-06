import { ADAPTERS, type IngestAdapterId } from '@jomma/shared'
import { env } from '@jomma/shared/env'
import { eq, sql } from 'drizzle-orm'
import type { Metadata } from 'next'
import { PageHeader } from '@/components/dash/page-header'
import { LocaleSegmented } from '@/components/locale-toggle'
import { StatusDot } from '@/components/status'
import { ThemeSegmented } from '@/components/theme-toggle'
import { requireBusiness } from '@/lib/auth/tenancy'
import { db } from '@/lib/db/client'
import { incomingPayments, receivingAccounts } from '@/lib/db/schema'
import { REF_CODE_LENGTH } from '@/lib/services/refs'
import { QUEUE_STALE_HOURS, UTILIZATION_STOP, UTILIZATION_WARN } from '@/lib/thresholds'

export const metadata: Metadata = { title: 'Settings' }
export const dynamic = 'force-dynamic'

/** Which adapters have actually delivered anything, so "enabled" is observed. */
async function adapterUsage(
  businessId: string,
): Promise<Record<string, { count: number; lastAt: string | null }>> {
  const rows = await db
    .select({
      adapter: incomingPayments.adapter,
      count: sql<string>`count(*)`,
      lastAt: sql<string | null>`max(${incomingPayments.receivedAt})`,
    })
    .from(incomingPayments)
    .innerJoin(receivingAccounts, eq(incomingPayments.receivingAccountId, receivingAccounts.id))
    .where(eq(receivingAccounts.businessId, businessId))
    .groupBy(incomingPayments.adapter)

  return Object.fromEntries(
    rows.map((row) => [row.adapter, { count: Number(row.count), lastAt: row.lastAt }]),
  )
}

const ADAPTER_NOTES: Record<IngestAdapterId, string> = {
  android_notification: 'The primary path. Fastest, and unaffected by operator delays.',
  android_sms: 'The second path. Fails independently of notifications — run both.',
  manual_entry: 'Paste a message on Reconcile. Always available, even with no phone.',
  statement_import: 'Weekly CSV on Reconcile. Catches anything every other path missed.',
  generic_webhook: 'Signed endpoint at POST /ingest/v1/webhook for any future source.',
  messages_bridge:
    'Best-effort only. It relays through the phone, so it does NOT protect against the phone being off — it is not redundancy for the primary failure mode. The pairing expires, it scrapes a DOM that changes without notice, and a signed-out session must be treated as a bridge that is down.',
}

export default async function SettingsPage() {
  const { business } = await requireBusiness()
  const config = env()
  const usage = await adapterUsage(business.id)

  return (
    <div className="flex h-svh min-h-0 flex-col">
      <PageHeader title="Settings" />
      <div className="min-h-0 flex-1 overflow-auto p-6">
        <div className="max-w-3xl space-y-8">
          <section className="space-y-2">
            <h2 className="text-title font-medium">Appearance</h2>
            <div className="flex flex-wrap items-center gap-3">
              <ThemeSegmented />
              <LocaleSegmented />
            </div>
            <p className="text-micro text-muted-foreground">
              Also in the sidebar menu, where it normally lives — this is set once, not adjusted.
            </p>
          </section>

          <section className="space-y-3">
            <div>
              <h2 className="text-title font-medium">Ingest adapters</h2>
              <p className="mt-0.5 max-w-2xl text-small text-muted-foreground">
                Every path money can reach Jomma by. All of them write to the same table and
                deduplicate on the same <span className="figure">trx_id</span>, so running several
                at once costs nothing and is the point.
              </p>
            </div>

            <div className="divide-y divide-border/50 overflow-hidden rounded-lg border border-border">
              {Object.values(ADAPTERS).map((adapter) => {
                const seen = usage[adapter.id]
                const bridgeOff =
                  adapter.id === 'messages_bridge' && !config.FEATURE_MESSAGES_BRIDGE

                return (
                  <div key={adapter.id} className="flex gap-3 px-3 py-2.5">
                    <StatusDot
                      tone={
                        bridgeOff
                          ? 'neutral'
                          : adapter.reliability === 'primary'
                            ? 'matched'
                            : adapter.reliability === 'secondary'
                              ? 'pending'
                              : 'ambiguous'
                      }
                      className="mt-1.5"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-2">
                        <span className="figure text-small">{adapter.id}</span>
                        <span className="text-micro text-muted-foreground">
                          {adapter.reliability}
                        </span>
                        {bridgeOff ? (
                          <span className="rounded-full bg-muted px-2 py-0.5 text-micro text-muted-foreground">
                            disabled
                          </span>
                        ) : null}
                        <span className="ml-auto text-micro text-muted-foreground">
                          {seen ? `${seen.count} captured` : 'nothing yet'}
                        </span>
                      </div>
                      <p className="mt-0.5 text-micro text-muted-foreground">
                        {ADAPTER_NOTES[adapter.id]}
                      </p>
                    </div>
                  </div>
                )
              })}
            </div>

            <p className="max-w-2xl text-micro text-muted-foreground">
              The Messages bridge is controlled by{' '}
              <span className="figure">FEATURE_MESSAGES_BRIDGE</span> in the environment rather than
              a toggle here — turning a best-effort scraper on is a deployment decision, not a
              click.
            </p>
          </section>

          <section className="space-y-3">
            <div>
              <h2 className="text-title font-medium">Alerts</h2>
              <p className="mt-0.5 max-w-2xl text-small text-muted-foreground">
                The worker raises these. Thresholds come from the environment so they are the same
                in every process that checks them.
              </p>
            </div>

            <div className="divide-y divide-border/50 overflow-hidden rounded-lg border border-border">
              <AlertRow
                severity="critical"
                condition="Heartbeat gap"
                threshold={`${config.HEARTBEAT_GAP_ALERT_MINUTES} min`}
                envVar="HEARTBEAT_GAP_ALERT_MINUTES"
                note="A phone that is switched off cannot tell you it is off. Absence is the signal."
              />
              <AlertRow
                severity="critical"
                condition="Balance drift, upward"
                threshold="any"
                envVar="—"
                note="Balance higher than expected means money arrived that was never seen. Stops routing."
              />
              <AlertRow
                severity="medium"
                condition="Balance drift, downward"
                threshold="any"
                envVar="—"
                note="Almost always an unrecorded outgoing send. Keeps routing, so a refund does not page you."
              />
              <AlertRow
                severity="critical"
                condition="Paid intent with no payment row"
                threshold="any"
                envVar="—"
                note="Must always be zero. Surfaced on Reconcile."
              />
              <AlertRow
                severity="high"
                condition="No captures in business hours"
                threshold={`${config.CAPTURE_SILENCE_ALERT_HOURS} h`}
                envVar="CAPTURE_SILENCE_ALERT_HOURS"
                note="Catches a removed SIM or a ported number, which still pass the heartbeat."
              />
              <AlertRow
                severity="high"
                condition="Parse failure"
                threshold="any"
                envVar="—"
                note="A provider may have changed its format. The raw text is kept for a re-parse."
              />
              <AlertRow
                severity="medium"
                condition="Queue item age"
                threshold={`${QUEUE_STALE_HOURS} h`}
                envVar="—"
                note="Somebody is waiting on a human decision."
              />
              <AlertRow
                severity="medium"
                condition="Daily limit"
                threshold={`${Math.round(UTILIZATION_WARN * 100)}% warn · ${Math.round(UTILIZATION_STOP * 100)}% stop`}
                envVar="—"
                note="Routing stops at the second number and fails over to another account."
              />
            </div>

            <p className="max-w-2xl text-micro text-muted-foreground">
              Delivery to a phone is not wired — alerts land in{' '}
              <span className="figure">notifier_events</span> and surface on Accounts. Pushing them
              somewhere is a deployment decision, same as the bridge.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-title font-medium">Environment</h2>
            <dl className="divide-y divide-border/50 overflow-hidden rounded-lg border border-border">
              <ConfigRow label="Match threshold" value={String(config.MATCH_APPROVE_THRESHOLD)} />
              <ConfigRow label="Ambiguity margin" value={String(config.MATCH_AMBIGUITY_MARGIN)} />
              <ConfigRow
                label="Intent TTL"
                value={`${config.INTENT_DEFAULT_TTL_SECONDS}s default · ${config.INTENT_MAX_TTL_SECONDS}s max`}
              />
              <ConfigRow
                label="Reference code"
                value={`${REF_CODE_LENGTH} characters, never reused`}
              />
              <ConfigRow
                label="Device IP allowlist"
                value={
                  config.DEVICE_IP_ALLOWLIST.length > 0
                    ? config.DEVICE_IP_ALLOWLIST.join(', ')
                    : 'off — any address'
                }
              />
              <ConfigRow label="App URL" value={config.APP_URL} />
            </dl>
            <p className="text-micro text-muted-foreground">
              Read-only. Changing a matching threshold from a web form on a running payments service
              is not a feature.
            </p>
          </section>
        </div>
      </div>
    </div>
  )
}

function AlertRow({
  severity,
  condition,
  threshold,
  envVar,
  note,
}: {
  severity: 'critical' | 'high' | 'medium'
  condition: string
  threshold: string
  envVar: string
  note: string
}) {
  return (
    <div className="flex gap-3 px-3 py-2.5">
      <StatusDot
        tone={severity === 'critical' ? 'offline' : severity === 'high' ? 'ambiguous' : 'pending'}
        className="mt-1.5"
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="text-small">{condition}</span>
          <span className="text-micro text-muted-foreground">{severity}</span>
          <span className="ml-auto figure text-micro">{threshold}</span>
        </div>
        <p className="mt-0.5 text-micro text-muted-foreground">
          {note}
          {envVar !== '—' ? <span className="figure"> · {envVar}</span> : null}
        </p>
      </div>
    </div>
  )
}

function ConfigRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 px-3 py-2">
      <dt className="text-small text-muted-foreground">{label}</dt>
      <dd className="figure min-w-0 truncate text-small">{value}</dd>
    </div>
  )
}
