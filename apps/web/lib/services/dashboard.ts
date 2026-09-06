import 'server-only'

import type { TransactionType } from '@jomma/shared'
import { and, count, desc, eq, gt, isNull, lt, or, sql } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import {
  incomingPayments,
  notifierEvents,
  orderPayments,
  paymentIntents,
  paymentRefs,
  receivingAccounts,
} from '@/lib/db/schema'
import { type AccountHealth, listAccountHealth } from './accounts'
import { minutesAgo } from './time'

/** Read models for the dashboard. Session-scoped, never exposed to a client app. */

export interface FeedRow {
  id: string
  receivedAt: string
  occurredAt: string | null
  amountCents: number | null
  senderMsisdn: string | null
  reference: string | null
  trxId: string | null
  status: 'unmatched' | 'matched' | 'orphaned' | 'refunded'
  parseStatus: 'ok' | 'partial' | 'failed'
  transactionType: TransactionType | null
  accountLabel: string
  accountProvider: 'bkash' | 'nagad'
  source: string
  intentReference: string | null
  matchConfidence: string | null
}

export interface FeedPage {
  rows: FeedRow[]
  /** Cursor for the live poll: the newest `received_at` in this page. */
  cursor: string | null
}

export async function getFeed(
  options: { limit?: number; since?: Date | null } = {},
): Promise<FeedPage> {
  const limit = Math.min(options.limit ?? 200, 500)

  const rows = await db
    .select({
      id: incomingPayments.id,
      receivedAt: incomingPayments.receivedAt,
      occurredAt: incomingPayments.occurredAt,
      amountCents: incomingPayments.amountCents,
      senderMsisdn: incomingPayments.senderMsisdn,
      reference: incomingPayments.referenceNormalized,
      trxId: incomingPayments.trxId,
      status: incomingPayments.status,
      parseStatus: incomingPayments.parseStatus,
      transactionType: incomingPayments.transactionType,
      source: incomingPayments.source,
      accountLabel: receivingAccounts.label,
      accountProvider: receivingAccounts.provider,
      intentReference: paymentIntents.clientReference,
      matchConfidence: orderPayments.matchConfidence,
    })
    .from(incomingPayments)
    .innerJoin(receivingAccounts, eq(incomingPayments.receivingAccountId, receivingAccounts.id))
    .leftJoin(
      orderPayments,
      and(
        eq(orderPayments.incomingPaymentId, incomingPayments.id),
        isNull(orderPayments.reversedAt),
      ),
    )
    .leftJoin(paymentIntents, eq(orderPayments.intentId, paymentIntents.id))
    .where(options.since ? gt(incomingPayments.receivedAt, options.since) : undefined)
    .orderBy(desc(incomingPayments.receivedAt))
    .limit(limit)

  return {
    rows: rows.map((row) => ({
      ...row,
      receivedAt: row.receivedAt.toISOString(),
      occurredAt: row.occurredAt?.toISOString() ?? null,
    })),
    cursor: rows[0]?.receivedAt.toISOString() ?? null,
  }
}

export interface SidebarCounts {
  feed: number
  queue: number
  intents: number
  alerts: number
}

/**
 * Counts for the nav badges. One round trip — these render on every page, so
 * five separate queries would be five per navigation.
 */
export async function getSidebarCounts(): Promise<SidebarCounts> {
  const [row] = await db
    .select({
      feed: sql<string>`count(*) filter (
        where ${incomingPayments.receivedAt} > now() - interval '24 hours'
      )`,
      queue: sql<string>`count(*) filter (
        where ${incomingPayments.status} = 'unmatched'
          or ${incomingPayments.parseStatus} = 'failed'
      )`,
    })
    .from(incomingPayments)

  const [intents] = await db
    .select({ value: count() })
    .from(paymentIntents)
    .where(eq(paymentIntents.status, 'open'))

  const [alerts] = await db
    .select({ value: count() })
    .from(notifierEvents)
    .where(
      and(
        isNull(notifierEvents.acknowledgedAt),
        or(eq(notifierEvents.severity, 'critical'), eq(notifierEvents.severity, 'high')),
      ),
    )

  return {
    feed: Number(row?.feed ?? 0),
    queue: Number(row?.queue ?? 0),
    intents: intents?.value ?? 0,
    alerts: alerts?.value ?? 0,
  }
}

export interface AccountFooterRow extends AccountHealth {
  deviceCount: number
  openAlerts: number
}

/**
 * The sidebar footer. This is the single most important layout decision in the
 * product: if a device goes down while you are looking at the queue, you see it
 * without navigating.
 */
export async function getAccountFooter(businessId: string): Promise<AccountFooterRow[]> {
  const health = await listAccountHealth(businessId)

  const alerts = await db
    .select({ accountId: notifierEvents.receivingAccountId, value: count() })
    .from(notifierEvents)
    .where(
      and(
        isNull(notifierEvents.acknowledgedAt),
        or(eq(notifierEvents.severity, 'critical'), eq(notifierEvents.severity, 'high')),
      ),
    )
    .groupBy(notifierEvents.receivingAccountId)

  const alertsByAccount = new Map(alerts.map((row) => [row.accountId, row.value]))

  const devices = await db
    .select({ accountId: receivingAccounts.id, value: count() })
    .from(receivingAccounts)
    .groupBy(receivingAccounts.id)

  const devicesByAccount = new Map(devices.map((row) => [row.accountId, row.value]))

  return health.map((account) => ({
    ...account,
    deviceCount: devicesByAccount.get(account.id) ?? 0,
    openAlerts: alertsByAccount.get(account.id) ?? 0,
  }))
}

/** Oldest first — the queue is worked from the top, and age is the priority. */
export async function getQueueDepth(): Promise<{
  depth: number
  oldestAt: string | null
}> {
  const [row] = await db
    .select({
      depth: count(),
      oldest: sql<string | null>`min(${incomingPayments.receivedAt})`,
    })
    .from(incomingPayments)
    .where(eq(incomingPayments.status, 'unmatched'))

  return { depth: row?.depth ?? 0, oldestAt: row?.oldest ?? null }
}

/**
 * The integrity check from docs/matching.md: intents marked paid with no payment
 * row. This must always be zero. If it is not, something wrote a paid status
 * without money behind it.
 */
export async function getPaidWithoutPaymentCount(): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(paymentIntents)
    .leftJoin(
      orderPayments,
      and(eq(orderPayments.intentId, paymentIntents.id), isNull(orderPayments.reversedAt)),
    )
    .where(and(eq(paymentIntents.status, 'matched'), isNull(orderPayments.id)))

  return row?.value ?? 0
}

/** Open intents older than their own TTL — the expiry sweep falling behind. */
export async function getOverdueIntentCount(): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(paymentIntents)
    .where(and(eq(paymentIntents.status, 'open'), lt(paymentIntents.expiresAt, new Date())))

  return row?.value ?? 0
}

export async function getRecentAlerts(limit = 20) {
  return db
    .select({
      id: notifierEvents.id,
      kind: notifierEvents.kind,
      severity: notifierEvents.severity,
      detail: notifierEvents.detail,
      createdAt: notifierEvents.createdAt,
      accountLabel: receivingAccounts.label,
    })
    .from(notifierEvents)
    .leftJoin(receivingAccounts, eq(notifierEvents.receivingAccountId, receivingAccounts.id))
    .where(isNull(notifierEvents.acknowledgedAt))
    .orderBy(desc(notifierEvents.createdAt))
    .limit(limit)
}

/** Parse failures in the last 24 hours — the "bKash changed its format" alarm. */
export async function getParseFailureCount(): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(incomingPayments)
    .where(
      and(
        eq(incomingPayments.parseStatus, 'failed'),
        gt(incomingPayments.receivedAt, minutesAgo(24 * 60)),
      ),
    )

  return row?.value ?? 0
}

export async function getOpenRefCodeCount(): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(paymentRefs)
    .where(eq(paymentRefs.status, 'open'))
  return row?.value ?? 0
}
