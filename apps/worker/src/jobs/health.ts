import { env } from '@jomma/shared/env'
import { and, eq, gt, isNull, lt, or, sql } from 'drizzle-orm'
import { db, schema } from '../db'
import { logger } from '../logger'

const { amountLocks, idempotencyKeys, incomingPayments, notifierEvents, receivingAccounts } = schema

/**
 * Health sweeps.
 *
 * These are pure bookkeeping over the worker's own view of the tables — no money
 * decisions. Anything that applies a payment goes through the web app's
 * `applyPayment`, because there must be exactly one implementation of that.
 */

/**
 * Locks whose TTL has passed.
 *
 * The partial unique index keys on `status = 'active'`, so a lapsed lock would
 * block a legitimate new claim on the same (account, amount). The create path
 * also reclaims inline, which makes this a tidiness job rather than something
 * correctness depends on.
 */
export async function sweepExpiredLocks(): Promise<number> {
  const released = await db
    .update(amountLocks)
    .set({ status: 'expired' })
    .where(and(eq(amountLocks.status, 'active'), lt(amountLocks.expiresAt, new Date())))
    .returning({ id: amountLocks.id })

  if (released.length > 0) logger.debug({ count: released.length }, 'expired amount locks')
  return released.length
}

/**
 * A phone that is switched off cannot tell you it is switched off, so absence
 * has to be detected from this side. One alert per gap, not one per sweep.
 */
export async function checkHeartbeatGaps(): Promise<number> {
  const gapMinutes = env().HEARTBEAT_GAP_ALERT_MINUTES
  const cutoff = new Date(Date.now() - gapMinutes * 60_000)

  const stale = await db
    .select({
      id: receivingAccounts.id,
      label: receivingAccounts.label,
      lastHeartbeatAt: receivingAccounts.lastHeartbeatAt,
    })
    .from(receivingAccounts)
    .where(
      and(
        eq(receivingAccounts.status, 'active'),
        or(
          isNull(receivingAccounts.lastHeartbeatAt),
          lt(receivingAccounts.lastHeartbeatAt, cutoff),
        ),
      ),
    )

  let raised = 0

  for (const account of stale) {
    // Do not re-alert while the same gap is still open and unacknowledged.
    const existing = await db
      .select({ id: notifierEvents.id })
      .from(notifierEvents)
      .where(
        and(
          eq(notifierEvents.receivingAccountId, account.id),
          eq(notifierEvents.kind, 'heartbeat_gap'),
          isNull(notifierEvents.acknowledgedAt),
        ),
      )
      .limit(1)

    if (existing.length > 0) continue

    await db.insert(notifierEvents).values({
      receivingAccountId: account.id,
      kind: 'heartbeat_gap',
      severity: 'critical',
      detail: account.lastHeartbeatAt
        ? `No heartbeat since ${account.lastHeartbeatAt.toISOString()}`
        : 'Never sent a heartbeat',
      payload: {
        gap_minutes: gapMinutes,
        last_heartbeat_at: account.lastHeartbeatAt,
      },
    })

    await db
      .update(receivingAccounts)
      .set({
        status: 'degraded',
        statusReason: `No device heartbeat for over ${gapMinutes} minutes.`,
      })
      .where(eq(receivingAccounts.id, account.id))

    raised += 1
    logger.error({ accountId: account.id, label: account.label }, 'heartbeat gap')
  }

  return raised
}

/**
 * The second alert the failure catalogue asks for: a SIM removed or a number
 * ported still passes the heartbeat, because the phone is fine — it just is not
 * receiving anything. Silence during business hours is the only signal.
 */
export async function checkCaptureSilence(): Promise<number> {
  const hours = env().CAPTURE_SILENCE_ALERT_HOURS
  const cutoff = new Date(Date.now() - hours * 3_600_000)

  // 09:00–22:00 Dhaka (UTC+6, no DST).
  const dhakaHour = new Date(Date.now() + 6 * 3_600_000).getUTCHours()
  if (dhakaHour < 9 || dhakaHour >= 22) return 0

  const silent = await db
    .select({ id: receivingAccounts.id, label: receivingAccounts.label })
    .from(receivingAccounts)
    .where(
      and(
        eq(receivingAccounts.status, 'active'),
        or(isNull(receivingAccounts.lastCaptureAt), lt(receivingAccounts.lastCaptureAt, cutoff)),
      ),
    )

  let raised = 0

  for (const account of silent) {
    const existing = await db
      .select({ id: notifierEvents.id })
      .from(notifierEvents)
      .where(
        and(
          eq(notifierEvents.receivingAccountId, account.id),
          eq(notifierEvents.kind, 'capture_silence'),
          isNull(notifierEvents.acknowledgedAt),
        ),
      )
      .limit(1)

    if (existing.length > 0) continue

    await db.insert(notifierEvents).values({
      receivingAccountId: account.id,
      kind: 'capture_silence',
      severity: 'high',
      detail: `No captures for ${hours}h during business hours`,
      payload: { hours },
    })

    raised += 1
    logger.warn({ accountId: account.id, label: account.label }, 'capture silence')
  }

  return raised
}

/** Parse failures in the last hour, batched into one alert rather than a storm. */
export async function checkParseFailures(): Promise<number> {
  const cutoff = new Date(Date.now() - 3_600_000)

  const [row] = await db
    .select({ value: sql<string>`count(*)` })
    .from(incomingPayments)
    .where(and(eq(incomingPayments.parseStatus, 'failed'), gt(incomingPayments.receivedAt, cutoff)))

  const count = Number(row?.value ?? 0)
  if (count > 0) {
    logger.warn({ count }, 'parse failures in the last hour — a message format may have changed')
  }
  return count
}

/** Expired idempotency records, so a key can be reused after its 24h window. */
export async function pruneIdempotencyKeys(): Promise<number> {
  const deleted = await db
    .delete(idempotencyKeys)
    .where(lt(idempotencyKeys.expiresAt, new Date()))
    .returning({ id: idempotencyKeys.id })

  return deleted.length
}
