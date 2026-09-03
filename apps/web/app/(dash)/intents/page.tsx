import type { Metadata } from 'next'
import { StubPage } from '@/components/dash/stub-page'

export const metadata: Metadata = { title: 'Intents' }

export default function IntentsPage() {
  return (
    <StubPage
      title="Intents"
      purpose="Open and recent payment requests, filterable by status and account."
      planned={[
        'Table of intents with status, amount, reference code, and time to expiry',
        'Detail sheet showing the full timeline read from payment_audit',
        'Filter by status and receiving account',
      ]}
    />
  )
}
