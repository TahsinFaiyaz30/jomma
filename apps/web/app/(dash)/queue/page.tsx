import type { Metadata } from 'next'
import { StubPage } from '@/components/dash/stub-page'

export const metadata: Metadata = { title: 'Queue' }

export default function QueuePage() {
  return (
    <StubPage
      title="Queue"
      purpose="Payments that need a human, oldest first. The matcher escalates here rather than guessing between two candidates."
      planned={[
        'Each row shows the incoming payment beside the candidate intents the scorer found',
        'Discrepancy highlighted: amount delta, reference edit distance, sender mismatch',
        'One-click approve and reject, operable with `a` and `r` — never requires a pointer',
        'Approval calls applyPayment(), the same transaction path as automatic matching',
        'Waiting time per item, so the oldest is obviously the oldest',
      ]}
    />
  )
}
