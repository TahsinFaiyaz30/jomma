import type { Metadata } from 'next'
import { PageHeader } from '@/components/dash/page-header'
import { LocaleSegmented } from '@/components/locale-toggle'
import { ThemeSegmented } from '@/components/theme-toggle'

export const metadata: Metadata = { title: 'Settings' }

export default function SettingsPage() {
  return (
    <div className="flex h-svh min-h-0 flex-col">
      <PageHeader title="Settings" />
      <div className="min-h-0 flex-1 overflow-auto p-6">
        <div className="max-w-xl space-y-6">
          <section className="space-y-2">
            <h2 className="text-title font-medium">Appearance</h2>
            <div className="flex flex-wrap items-center gap-3">
              <ThemeSegmented />
              <LocaleSegmented />
            </div>
            <p className="text-micro text-muted-foreground">
              Also available from the sidebar menu, where it normally lives — this is set once, not
              adjusted.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-title font-medium">Adapters</h2>
            <p className="max-w-xl text-small text-muted-foreground">
              Not built yet. The Messages bridge is off by default behind{' '}
              <span className="figure">FEATURE_MESSAGES_BRIDGE</span> and must be labelled
              best-effort wherever it is enabled: it relays through the phone, so it is not
              redundancy for the phone being off.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-title font-medium">Alerts</h2>
            <p className="max-w-xl text-small text-muted-foreground">
              Not built yet. Thresholds live in the environment for now —{' '}
              <span className="figure">HEARTBEAT_GAP_ALERT_MINUTES</span> and{' '}
              <span className="figure">CAPTURE_SILENCE_ALERT_HOURS</span>.
            </p>
          </section>
        </div>
      </div>
    </div>
  )
}
