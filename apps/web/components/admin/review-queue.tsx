'use client'

import type { BusinessStatus } from '@jomma/shared'
import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { reviewBusinessAction } from '@/app/admin/actions'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import type { BusinessReviewRow } from '@/lib/services/businesses'

/**
 * The platform's review queue.
 *
 * Pending first, because the queue's whole purpose is the decisions waiting to
 * be made — a list sorted purely by date buries them under approvals already
 * done.
 *
 * Everything the reviewer needs is on the row: what they said they sell, how to
 * reach them, and whether they have actually set anything up. A business with
 * no receiving account has not tried yet, which is worth knowing before
 * approving one.
 */

const TONE: Record<BusinessStatus, string> = {
  pending: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
  active: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
  rejected: 'bg-red-500/15 text-red-700 dark:text-red-400',
  suspended: 'bg-red-500/15 text-red-700 dark:text-red-400',
}

export function ReviewQueue({ businesses }: { businesses: BusinessReviewRow[] }) {
  if (businesses.length === 0) {
    return (
      <p className="p-6 text-muted-foreground text-sm">
        No businesses have registered on this instance yet.
      </p>
    )
  }

  return (
    <div className="divide-y">
      {businesses.map((business) => (
        <Row key={business.id} business={business} />
      ))}
    </div>
  )
}

function Row({ business }: { business: BusinessReviewRow }) {
  const [reason, setReason] = useState('')
  const [pending, startTransition] = useTransition()

  const review = (status: Exclude<BusinessStatus, 'pending'>) => {
    // Approval needs no justification because nothing is being taken away;
    // everything else is shown to the merchant, so it cannot be blank.
    if (status !== 'active' && !reason.trim()) {
      toast.error('Say why. They are shown this.')
      return
    }

    startTransition(async () => {
      const result = await reviewBusinessAction(business.id, status, reason)
      toast[result.ok ? 'success' : 'error'](result.message)
      if (result.ok) setReason('')
    })
  }

  return (
    <div className="space-y-3 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex items-center gap-2">
            <span className="font-medium">{business.name}</span>
            <Badge className={TONE[business.status]} variant="secondary">
              {business.status}
            </Badge>
          </div>
          <p className="text-muted-foreground text-sm">
            {business.contactEmail ?? 'no email'}
            {business.contactPhone ? ` · ${business.contactPhone}` : ''}
          </p>
          {business.description ? (
            <p className="max-w-prose text-sm">{business.description}</p>
          ) : null}
        </div>

        <div className="shrink-0 text-right text-muted-foreground text-xs tabular-nums">
          <div>{new Date(business.createdAt).toLocaleDateString()}</div>
          <div>
            {business.memberCount} member{business.memberCount === 1 ? '' : 's'} ·{' '}
            {business.accountCount} number{business.accountCount === 1 ? '' : 's'}
          </div>
        </div>
      </div>

      {business.statusReason ? (
        <p className="text-muted-foreground text-sm">
          <span className="font-medium">Reason:</span> {business.statusReason}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Reason (required to decline or suspend)"
          className="h-9 max-w-md flex-1"
          disabled={pending}
        />

        {pending ? <Spinner /> : null}

        {business.status !== 'active' ? (
          <Button size="sm" onClick={() => review('active')} disabled={pending}>
            Approve
          </Button>
        ) : null}

        {business.status === 'pending' ? (
          <Button size="sm" variant="outline" onClick={() => review('rejected')} disabled={pending}>
            Decline
          </Button>
        ) : null}

        {business.status === 'active' ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => review('suspended')}
            disabled={pending}
          >
            Suspend
          </Button>
        ) : null}
      </div>
    </div>
  )
}
