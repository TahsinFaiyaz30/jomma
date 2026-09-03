import 'server-only'

import type { IntentStatus } from '@jomma/shared'
import { toPublicId } from '@jomma/shared'
import { and, desc, eq, isNull, or, sql } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import {
  apps,
  incomingPayments,
  orderPayments,
  paymentAudit,
  paymentIntents,
  paymentRefs,
  paymentSubmissions,
  receivingAccounts,
} from '@/lib/db/schema'

/** Read models for the Intents screen. Dashboard-only — never a tenant surface. */

export interface IntentRow {
  id: string
  publicId: string
  status: IntentStatus
  amountCents: number
  receivedAmountCents: number
  clientReference: string
  refCode: string | null
  payerMsisdn: string | null
  appName: string
  accountLabel: string
  accountMsisdn: string
  createdAt: string
  expiresAt: string
  matchedAt: string | null
}

export interface IntentFilters {
  status?: IntentStatus | 'all'
  accountId?: string | 'all'
  search?: string
}

export async function listIntents(filters: IntentFilters = {}, limit = 200): Promise<IntentRow[]> {
  const conditions = []

  if (filters.status && filters.status !== 'all') {
    conditions.push(eq(paymentIntents.status, filters.status))
  }
  if (filters.accountId && filters.accountId !== 'all') {
    conditions.push(eq(paymentIntents.receivingAccountId, filters.accountId))
  }
  if (filters.search?.trim()) {
    const needle = `%${filters.search.trim()}%`
    conditions.push(
      or(
        sql`${paymentIntents.clientReference} ilike ${needle}`,
        sql`${paymentRefs.code} ilike ${needle}`,
        sql`${paymentIntents.payerMsisdn} ilike ${needle}`,
      ),
    )
  }

  const rows = await db
    .select({
      intent: paymentIntents,
      refCode: paymentRefs.code,
      appName: apps.name,
      accountLabel: receivingAccounts.label,
      accountMsisdn: receivingAccounts.msisdn,
    })
    .from(paymentIntents)
    .innerJoin(apps, eq(paymentIntents.appId, apps.id))
    .innerJoin(receivingAccounts, eq(paymentIntents.receivingAccountId, receivingAccounts.id))
    .leftJoin(paymentRefs, eq(paymentRefs.intentId, paymentIntents.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(paymentIntents.createdAt))
    .limit(limit)

  return rows.map(({ intent, refCode, appName, accountLabel, accountMsisdn }) => ({
    id: intent.id,
    publicId: toPublicId('intent', intent.id),
    status: intent.status,
    amountCents: intent.amountCents,
    receivedAmountCents: intent.receivedAmountCents,
    clientReference: intent.clientReference,
    refCode,
    payerMsisdn: intent.payerMsisdn,
    appName,
    accountLabel,
    accountMsisdn,
    createdAt: intent.createdAt.toISOString(),
    expiresAt: intent.expiresAt.toISOString(),
    matchedAt: intent.matchedAt?.toISOString() ?? null,
  }))
}

export interface TimelineEntry {
  id: string
  action: string
  actorType: string
  requestId: string | null
  payload: Record<string, unknown>
  createdAt: string
}

export interface IntentDetail extends IntentRow {
  metadata: Record<string, unknown>
  payments: Array<{
    trxId: string | null
    senderMsisdn: string | null
    appliedCents: number
    appliedAt: string
    confidence: string
    matchedBy: string
    score: number | null
    reversedAt: string | null
  }>
  submissions: Array<{
    trxId: string
    resolution: string | null
    status: string
    createdAt: string
  }>
  /**
   * The full audit trail. This is what makes a reversal defensible — what was
   * seen, what scored what, and who decided.
   */
  timeline: TimelineEntry[]
}

export async function getIntentDetail(intentId: string): Promise<IntentDetail | null> {
  const intent = await db.query.paymentIntents.findFirst({
    where: eq(paymentIntents.id, intentId),
    with: { receivingAccount: true, app: true },
  })
  if (!intent) return null

  const ref = await db.query.paymentRefs.findFirst({
    where: eq(paymentRefs.intentId, intentId),
    orderBy: desc(paymentRefs.createdAt),
  })

  const applications = await db
    .select({
      trxId: incomingPayments.trxId,
      senderMsisdn: incomingPayments.senderMsisdn,
      appliedCents: orderPayments.appliedCents,
      appliedAt: orderPayments.appliedAt,
      confidence: orderPayments.matchConfidence,
      matchedBy: orderPayments.matchedBy,
      score: orderPayments.matchScore,
      reversedAt: orderPayments.reversedAt,
    })
    .from(orderPayments)
    .innerJoin(incomingPayments, eq(orderPayments.incomingPaymentId, incomingPayments.id))
    .where(eq(orderPayments.intentId, intentId))
    .orderBy(orderPayments.appliedAt)

  const submissions = await db
    .select({
      trxId: paymentSubmissions.trxId,
      resolution: paymentSubmissions.resolution,
      status: paymentSubmissions.status,
      createdAt: paymentSubmissions.createdAt,
    })
    .from(paymentSubmissions)
    .where(eq(paymentSubmissions.intentId, intentId))
    .orderBy(desc(paymentSubmissions.createdAt))

  const timeline = await db
    .select()
    .from(paymentAudit)
    .where(eq(paymentAudit.intentId, intentId))
    .orderBy(paymentAudit.createdAt)

  return {
    id: intent.id,
    publicId: toPublicId('intent', intent.id),
    status: intent.status,
    amountCents: intent.amountCents,
    receivedAmountCents: intent.receivedAmountCents,
    clientReference: intent.clientReference,
    refCode: ref?.code ?? null,
    payerMsisdn: intent.payerMsisdn,
    appName: intent.app.name,
    accountLabel: intent.receivingAccount.label,
    accountMsisdn: intent.receivingAccount.msisdn,
    createdAt: intent.createdAt.toISOString(),
    expiresAt: intent.expiresAt.toISOString(),
    matchedAt: intent.matchedAt?.toISOString() ?? null,
    metadata: intent.metadata,
    payments: applications.map((a) => ({
      trxId: a.trxId,
      senderMsisdn: a.senderMsisdn,
      appliedCents: a.appliedCents,
      appliedAt: a.appliedAt.toISOString(),
      confidence: a.confidence,
      matchedBy: a.matchedBy,
      score: a.score,
      reversedAt: a.reversedAt?.toISOString() ?? null,
    })),
    submissions: submissions.map((s) => ({
      trxId: s.trxId,
      resolution: s.resolution,
      status: s.status,
      createdAt: s.createdAt.toISOString(),
    })),
    timeline: timeline.map((entry) => ({
      id: entry.id,
      action: entry.action,
      actorType: entry.actorType,
      requestId: entry.requestId,
      payload: entry.payload,
      createdAt: entry.createdAt.toISOString(),
    })),
  }
}

/** Options for the filter bar. */
export async function getIntentFilterOptions() {
  const accounts = await db
    .select({ id: receivingAccounts.id, label: receivingAccounts.label })
    .from(receivingAccounts)
    .orderBy(receivingAccounts.label)

  const [counts] = await db
    .select({
      open: sql<string>`count(*) filter (where status = 'open')`,
      matched: sql<string>`count(*) filter (where status = 'matched')`,
      partial: sql<string>`count(*) filter (where status = 'partial')`,
      total: sql<string>`count(*)`,
    })
    .from(paymentIntents)

  return {
    accounts,
    counts: {
      open: Number(counts?.open ?? 0),
      matched: Number(counts?.matched ?? 0),
      partial: Number(counts?.partial ?? 0),
      total: Number(counts?.total ?? 0),
    },
  }
}

/**
 * Reversal candidates: applications that are still live. Used by the detail
 * sheet, which is the only place a match can be undone.
 */
export async function listReversibleApplications(intentId: string) {
  return db
    .select({ id: orderPayments.id, appliedCents: orderPayments.appliedCents })
    .from(orderPayments)
    .where(and(eq(orderPayments.intentId, intentId), isNull(orderPayments.reversedAt)))
}

export const INTENT_STATUS_OPTIONS: Array<IntentStatus | 'all'> = [
  'all',
  'open',
  'matched',
  'partial',
  'over',
  'expired',
  'cancelled',
]
