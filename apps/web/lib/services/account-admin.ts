import 'server-only'

import { toPublicId } from '@jomma/shared'
import { and, desc, eq, inArray, isNull } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { apps, notifierEvents, receivingAccounts } from '@/lib/db/schema'
import { audit } from './audit'
import { queueEvent } from './events'

/**
 * Admin operations on receiving accounts.
 *
 * Disabling is the manual half of the failover story: when a number is frozen
 * or a phone is gone for the day, an operator takes it out of rotation and
 * checkout routes around it. Clients are told, because a client that keeps
 * showing a pay page for a dead number is the problem this prevents.
 */
export async function setAccountStatus(options: {
  accountId: string
  status: 'active' | 'disabled'
  actorId: string
  reason?: string
}): Promise<void> {
  await db.transaction(async (tx) => {
    const [account] = await tx
      .update(receivingAccounts)
      .set({
        status: options.status,
        statusReason:
          options.status === 'disabled' ? (options.reason ?? 'Disabled from the dashboard') : null,
        // Re-enabling clears the drift latch; the next capture re-anchors the
        // balance. Leaving it set would mean the account never becomes routable.
        ...(options.status === 'active' ? { balanceDrift: false, balanceDriftCents: null } : {}),
      })
      .where(eq(receivingAccounts.id, options.accountId))
      .returning()

    if (!account) throw new Error('Unknown account')

    await audit(tx, {
      action: options.status === 'disabled' ? 'account.degraded' : 'account.recovered',
      actorId: options.actorId,
      actorType: 'admin',
      payload: { account_id: account.id, msisdn: account.msisdn, status: options.status },
    })

    // Every app needs to know — this changes whether they can take payments.
    const tenants = await tx.select({ id: apps.id }).from(apps).where(eq(apps.status, 'active'))

    for (const tenant of tenants) {
      await queueEvent(tx, {
        appId: tenant.id,
        type: options.status === 'disabled' ? 'account.degraded' : 'account.recovered',
        data: {
          account_id: toPublicId('account', account.id),
          provider: account.provider,
          msisdn: account.msisdn,
          status: options.status,
          reason: account.statusReason ?? '',
        },
      })
    }
  })
}

export async function acknowledgeAlert(options: {
  eventId: string
  actorId: string
}): Promise<void> {
  await db
    .update(notifierEvents)
    .set({ acknowledgedAt: new Date(), acknowledgedBy: options.actorId })
    .where(and(eq(notifierEvents.id, options.eventId), isNull(notifierEvents.acknowledgedAt)))
}

export async function listAccountAlerts(receivingAccountId: string, limit = 10) {
  const rows = await db
    .select()
    .from(notifierEvents)
    .where(
      and(
        eq(notifierEvents.receivingAccountId, receivingAccountId),
        isNull(notifierEvents.acknowledgedAt),
        // Heartbeats and boots are telemetry, not alerts. Listing every routine
        // event as something to acknowledge buries the one that matters, which
        // is precisely the alarm fatigue docs/design.md warns about.
        inArray(notifierEvents.severity, ['critical', 'high', 'medium']),
      ),
    )
    .orderBy(desc(notifierEvents.createdAt))
    .limit(limit)

  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    severity: row.severity,
    detail: row.detail,
    createdAt: row.createdAt.toISOString(),
  }))
}
