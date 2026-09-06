'use server'

import { toPublicId } from '@jomma/shared'
import { and, desc, eq, ilike, or, sql } from 'drizzle-orm'
import { requireBusiness } from '@/lib/auth/tenancy'
import { db } from '@/lib/db/client'
import {
  apps,
  incomingPayments,
  paymentIntents,
  paymentRefs,
  receivingAccounts,
} from '@/lib/db/schema'

/**
 * Lookup behind the command palette.
 *
 * Deliberately narrow: the handful of identifiers an operator actually has in
 * front of them when someone is on the phone claiming they paid — a TrxID read
 * off a screenshot, a four-character reference, the client's own order id, the
 * last digits of a number. Not a full-text search over message bodies, which
 * would be slow and would mostly return the wrong thing.
 */

export interface PaletteHit {
  kind: 'payment' | 'intent'
  /** Public id for intents, row id for payments — what the target page expects. */
  id: string
  primary: string
  secondary: string
  amountCents: number
  status: string
}

/** Below this every query is a prefix of everything, and the results are noise. */
const MIN_QUERY = 2

/**
 * A three-digit fragment matches most numbers in the table; four is where it
 * starts being a search rather than a scan. Below that the clause is dropped
 * entirely rather than given a pattern that cannot match — a sentinel string is
 * one build step away from becoming something Postgres rejects.
 */
const MIN_MSISDN_FRAGMENT = 4

export async function paletteSearch(query: string): Promise<PaletteHit[]> {
  /*
   * Scoped, not merely authenticated.
   *
   * This used to call `requireAdmin`, which answers "are you signed in" and
   * nothing else, and then searched every payment and intent on the instance.
   * On a shared deployment that made the command palette a cross-tenant reader:
   * any merchant could type four digits of somebody else's customer's number
   * and read their amounts, order references and TrxIDs back. It hid because it
   * lives beside the pages rather than in them, and looks like a widget rather
   * than a query.
   */
  const { business } = await requireBusiness()

  const trimmed = query.trim()
  if (trimmed.length < MIN_QUERY) return []

  const like = `%${trimmed}%`
  const upper = trimmed.toUpperCase()
  const digits = trimmed.replace(/\D/g, '')
  const byDigits = digits.length >= MIN_MSISDN_FRAGMENT

  const [payments, intents] = await Promise.all([
    db
      .select({
        id: incomingPayments.id,
        trxId: incomingPayments.trxId,
        senderMsisdn: incomingPayments.senderMsisdn,
        referenceRaw: incomingPayments.referenceRaw,
        amountCents: incomingPayments.amountCents,
        status: incomingPayments.status,
      })
      .from(incomingPayments)
      .innerJoin(receivingAccounts, eq(incomingPayments.receivingAccountId, receivingAccounts.id))
      .where(
        and(
          eq(receivingAccounts.businessId, business.id),
          or(
            ilike(incomingPayments.trxId, like),
            ilike(incomingPayments.referenceNormalized, `%${upper}%`),
            byDigits ? ilike(incomingPayments.senderMsisdn, `%${digits}%`) : sql`false`,
          ),
        ),
      )
      .orderBy(desc(incomingPayments.receivedAt))
      .limit(6),

    db
      .select({
        id: paymentIntents.id,
        refCode: paymentRefs.code,
        clientReference: paymentIntents.clientReference,
        amountCents: paymentIntents.amountCents,
        status: paymentIntents.status,
      })
      .from(paymentIntents)
      .innerJoin(apps, eq(paymentIntents.appId, apps.id))
      .leftJoin(paymentRefs, eq(paymentRefs.intentId, paymentIntents.id))
      .where(
        and(
          eq(apps.businessId, business.id),
          or(
            eq(paymentRefs.code, upper),
            ilike(paymentIntents.clientReference, like),
            byDigits ? ilike(paymentIntents.payerMsisdn, `%${digits}%`) : sql`false`,
          ),
        ),
      )
      .orderBy(desc(paymentIntents.createdAt))
      .limit(6),
  ])

  return [
    ...intents.map(
      (row): PaletteHit => ({
        kind: 'intent',
        id: toPublicId('intent', row.id),
        primary: row.refCode ?? '-',
        secondary: row.clientReference,
        amountCents: row.amountCents,
        status: row.status,
      }),
    ),
    ...payments.map(
      (row): PaletteHit => ({
        kind: 'payment',
        id: row.id,
        primary: row.trxId ?? 'unparsed',
        secondary: row.referenceRaw ?? row.senderMsisdn ?? '',
        amountCents: row.amountCents ?? 0,
        status: row.status,
      }),
    ),
  ]
}
