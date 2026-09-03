import type { Metadata } from 'next'
import { StubPage } from '@/components/dash/stub-page'

export const metadata: Metadata = { title: 'Apps' }

export default function AppsPage() {
  return (
    <StubPage
      title="Apps"
      purpose="Client applications, their API keys, and their webhook endpoints."
      planned={[
        'API key creation — plaintext shown once (generateApiKey already exists)',
        'Webhook endpoint configuration with per-endpoint secret and event selection',
        'Delivery log from webhook_deliveries with manual replay of failed events',
      ]}
    />
  )
}
