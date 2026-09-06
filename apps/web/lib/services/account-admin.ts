import 'server-only'

import type { CaptureSettings } from '@jomma/shared'
import { toPublicId } from '@jomma/shared'
import { and, desc, eq, inArray, isNull } from 'drizzle-orm'
import type { Database, Tx } from '@/lib/db/client'
import { db } from '@/lib/db/client'
import { apps, notifierEvents, receivingAccounts } from '@/lib/db/schema'
// Shared with the ingest webhook's account lookup. Two copies of this rule that
// drift apart means one surface accepting a number the other stores differently.
import { canonicalMsisdn as normalizeMsisdn } from '@/lib/matching/normalize'
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

/**
 * Adds a number for Jomma to watch.
 *
 * This used to exist only in the development seed, which was fine while the
 * seed also created demo accounts — and became a dead end the moment production
 * bootstrapped with `--admin-only` and had no way to add a real one.
 *
 * Created `disabled`, deliberately. An active account is immediately eligible
 * for checkout routing, and an account with no phone attached to it cannot see
 * a payment arrive — so a buyer would be sent to a number nobody is watching.
 * Provision a device first, then enable it.
 */
export async function createReceivingAccount(options: {
  /** Whose number this is. Resolved from the session, never from the form. */
  businessId: string
  provider: 'bkash' | 'nagad'
  msisdn: string
  label: string
  actorId: string
}): Promise<{ id: string; msisdn: string }> {
  const msisdn = normalizeMsisdn(options.msisdn)
  if (!msisdn) {
    throw new Error('Not a Bangladeshi mobile number. Expected 11 digits starting 01.')
  }

  const existing = await db.query.receivingAccounts.findFirst({
    where: eq(receivingAccounts.msisdn, msisdn),
  })
  // Globally, not just within this business: one physical number cannot be
  // watched by two merchants, because the captures would be indistinguishable
  // and each would see the other's incoming money.
  if (existing) throw new Error(`${msisdn} is already being watched.`)

  return db.transaction(async (tx) => {
    const [account] = await tx
      .insert(receivingAccounts)
      .values({
        businessId: options.businessId,
        provider: options.provider,
        msisdn,
        label: options.label.trim(),
        status: 'disabled',
        statusReason: 'Added from the dashboard. Provision a phone, then enable it.',
      })
      .returning()

    if (!account) throw new Error('Could not create the account.')

    await audit(tx, {
      action: 'account.created',
      actorId: options.actorId,
      actorType: 'admin',
      payload: { account_id: account.id, msisdn, provider: options.provider },
    })

    return { id: account.id, msisdn }
  })
}

/**
 * What this number keeps besides incoming Send Money.
 *
 * Stored on the account and not on the device, which is what makes "the same
 * settings on both sides" true rather than approximately true. Two phones
 * watching one number cannot disagree, re-provisioning a phone cannot silently
 * reset it, and the dashboard and the app are reading the same row.
 *
 * The phone is a remote control here, not a second source of truth. It does no
 * parsing at all — `NotificationListener` forwards raw text — so classification
 * only ever happens in `lib/parsers`, and there is no Kotlin copy of the
 * grammar to drift out of step with it.
 */
export async function getCaptureSettings(
  accountId: string,
  client: Database | Tx = db,
): Promise<CaptureSettings> {
  const [account] = await client
    .select({
      cashIn: receivingAccounts.captureCashIn,
      outgoing: receivingAccounts.captureOutgoing,
      other: receivingAccounts.captureOther,
    })
    .from(receivingAccounts)
    .where(eq(receivingAccounts.id, accountId))
    .limit(1)

  if (!account) throw new Error('Unknown account')

  return { cash_in: account.cashIn, outgoing: account.outgoing, other: account.other }
}

export async function setCaptureSettings(options: {
  accountId: string
  settings: CaptureSettings
  /** Null when the phone changed it — a device is not a user. */
  actorId: string | null
  actorType: 'admin' | 'device'
}): Promise<CaptureSettings> {
  return db.transaction(async (tx) => {
    const [account] = await tx
      .update(receivingAccounts)
      .set({
        captureCashIn: options.settings.cash_in,
        captureOutgoing: options.settings.outgoing,
        captureOther: options.settings.other,
      })
      .where(eq(receivingAccounts.id, options.accountId))
      .returning()

    if (!account) throw new Error('Unknown account')

    await audit(tx, {
      action: 'account.updated',
      actorId: options.actorId ?? undefined,
      actorType: options.actorType,
      payload: { account_id: account.id, capture: options.settings },
    })

    return {
      cash_in: account.captureCashIn,
      outgoing: account.captureOutgoing,
      other: account.captureOther,
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
