import { randomInt } from 'node:crypto'
import type { AccountStatus, Provider, ProviderPreference } from '@jomma/shared'
import { env } from '@jomma/shared/env'
import { and, eq, gte, inArray, isNotNull, sql } from 'drizzle-orm'
import type { Database, Tx } from '@/lib/db/client'
import { db } from '@/lib/db/client'
import { incomingPayments, receivingAccounts } from '@/lib/db/schema'
import { UTILIZATION_STOP } from '@/lib/thresholds'
import { minutesAgo, startOfBusinessDay, startOfBusinessMonth } from './time'

export interface AccountHealth {
  id: string
  provider: Provider
  msisdn: string
  label: string
  status: AccountStatus
  statusReason: string | null
  lastHeartbeatAt: Date | null
  lastCaptureAt: Date | null
  balanceDrift: boolean
  balanceDriftCents: number | null
  lastKnownBalanceCents: number | null
  dailyUsedCents: number
  dailyLimitCents: number
  monthlyUsedCents: number
  monthlyLimitCents: number
  utilization: number
  /** Derived, not stored: healthy enough to route a new intent to. */
  routable: boolean
  heartbeatStale: boolean
}

// Re-exported so server callers can keep importing them from here; the values
// live in lib/thresholds.ts because client components need them too.
export { UTILIZATION_STOP, UTILIZATION_WARN } from '@/lib/thresholds'

/**
 * Health for every receiving account, with today's and this month's volume.
 *
 * Volume is summed from `incoming_payments` rather than tracked in a counter
 * column: a counter can drift, and the whole point of this product is that
 * observed money is the only source of truth.
 */
export async function listAccountHealth(client: Database | Tx = db): Promise<AccountHealth[]> {
  const config = env()
  const dayStart = startOfBusinessDay()
  const monthStart = startOfBusinessMonth()
  const heartbeatCutoff = minutesAgo(config.HEARTBEAT_GAP_ALERT_MINUTES)

  const rows = await client
    .select({
      account: receivingAccounts,
      dailyUsed: sql<string>`coalesce(sum(${incomingPayments.amountCents}) filter (
        where ${incomingPayments.receivedAt} >= ${dayStart.toISOString()}
      ), 0)`,
      monthlyUsed: sql<string>`coalesce(sum(${incomingPayments.amountCents}) filter (
        where ${incomingPayments.receivedAt} >= ${monthStart.toISOString()}
      ), 0)`,
    })
    .from(receivingAccounts)
    .leftJoin(
      incomingPayments,
      and(
        eq(incomingPayments.receivingAccountId, receivingAccounts.id),
        gte(incomingPayments.receivedAt, monthStart),
        inArray(incomingPayments.status, ['matched', 'unmatched', 'orphaned']),
      ),
    )
    .groupBy(receivingAccounts.id)

  return rows.map(({ account, dailyUsed, monthlyUsed }) => {
    const dailyUsedCents = Number(dailyUsed)
    const monthlyUsedCents = Number(monthlyUsed)
    const utilization = account.dailyLimitCents > 0 ? dailyUsedCents / account.dailyLimitCents : 0

    const heartbeatStale =
      account.lastHeartbeatAt === null || account.lastHeartbeatAt < heartbeatCutoff

    return {
      id: account.id,
      provider: account.provider,
      msisdn: account.msisdn,
      label: account.label,
      status: account.status,
      statusReason: account.statusReason,
      lastHeartbeatAt: account.lastHeartbeatAt,
      lastCaptureAt: account.lastCaptureAt,
      balanceDrift: account.balanceDrift,
      balanceDriftCents: account.balanceDriftCents,
      lastKnownBalanceCents: account.lastKnownBalanceCents,
      dailyUsedCents,
      dailyLimitCents: account.dailyLimitCents,
      monthlyUsedCents,
      monthlyLimitCents: account.monthlyLimitCents,
      utilization,
      heartbeatStale,
      routable:
        account.status === 'active' &&
        !heartbeatStale &&
        !account.balanceDrift &&
        utilization < UTILIZATION_STOP &&
        monthlyUsedCents < account.monthlyLimitCents,
    }
  })
}

/**
 * Routing order for a new intent.
 *
 * Preference first, then least-utilised. `random` breaks ties so two accounts at
 * identical volume alternate instead of one always absorbing the traffic.
 */
export function routableAccounts(
  accounts: AccountHealth[],
  preference: ProviderPreference,
): AccountHealth[] {
  const routable = accounts.filter((account) => account.routable)
  const eligible =
    preference === 'any' ? routable : routable.filter((account) => account.provider === preference)

  return eligible.sort((a, b) => {
    const byUtilisation = a.utilization - b.utilization
    if (Math.abs(byUtilisation) > 0.001) return byUtilisation
    return randomInt(0, 2) === 0 ? -1 : 1
  })
}

/** Bumps the account's capture clock. Feeds the "no captures for 3 hours" alert. */
export async function touchCapture(
  tx: Database | Tx,
  receivingAccountId: string,
  at: Date = new Date(),
): Promise<void> {
  await tx
    .update(receivingAccounts)
    .set({ lastCaptureAt: at })
    .where(and(eq(receivingAccounts.id, receivingAccountId), isNotNull(receivingAccounts.id)))
}
