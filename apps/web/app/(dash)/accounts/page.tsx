import type { Metadata } from 'next'
import { StubPage } from '@/components/dash/stub-page'

export const metadata: Metadata = { title: 'Accounts' }

export default function AccountsPage() {
  return (
    <StubPage
      title="Accounts"
      purpose="Receiving accounts, their devices, and their limits. Live health for these already renders in the sidebar footer."
      planned={[
        'Device list per account with last heartbeat, battery, and queue depth',
        'Provisioning QR and token rotation (generateDeviceToken already exists)',
        'Daily and monthly utilisation, warning at 80% and stop-routing at 95%',
        'Acknowledge open alerts from notifier_events',
      ]}
    />
  )
}
