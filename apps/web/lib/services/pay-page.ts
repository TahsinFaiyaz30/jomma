import 'server-only'

import { fromPublicId } from '@jomma/shared'
import { and, asc, eq, isNull } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import {
  apps,
  incomingPayments,
  orderPayments,
  paymentIntents,
  paymentRefs,
  receivingAccounts,
} from '@/lib/db/schema'
import { type CheckoutMethod, listCheckoutMethods } from './checkout'
import { safeRedirect } from './redirects'

/**
 * What the hosted pay page is allowed to know.
 *
 * The buyer is an anonymous visitor holding a URL. They get exactly the fields
 * needed to complete a Send Money and to see whether it landed — and nothing
 * else. No account id, no device state, no other payments on the number, no
 * daily-limit utilisation, no client reference (which is the merchant's order
 * id and is theirs, not the buyer's, to expose).
 *
 * Everything here is derived server-side. There is no API key in the browser
 * because there is no API call from the browser to Jomma's client API at all.
 */

export interface PayView {
  /** The public id, echoed back so the poller knows what it is watching. */
  id: string
  status: 'open' | 'partial' | 'matched' | 'expired' | 'cancelled'

  provider: 'bkash' | 'nagad'
  /** Local format, 01XXXXXXXXX — what the buyer types into bKash. */
  receivingMsisdn: string
  merchantName: string

  amountCents: number
  receivedAmountCents: number
  shortfallCents: number

  /** The 4-character code that goes in the provider's Reference field. */
  refCode: string | null

  /**
   * Payments already applied, oldest first.
   *
   * Split payments are ordinary here: several TrxIDs can land against one
   * intent and the outstanding amount is the difference. The buyer needs to see
   * what has been counted, or a second request for money looks like a mistake.
   */
  payments: Array<{
    trxId: string | null
    amountCents: number
    appliedAt: string
  }>

  /** How this can be paid, and which one it is routed to now. */
  methods: CheckoutMethod[]
  /** False once anything has arrived — the account is pinned from then on. */
  canSwitchMethod: boolean

  expiresAt: string
  /** Null unless the app registered the host. Never echoed back unchecked. */
  returnUrl: string | null
  cancelUrl: string | null
}

/** bKash shows and expects the local form, not +880. */
function toLocalMsisdn(msisdn: string): string {
  const digits = msisdn.replace(/\D/g, '')
  const local = digits.startsWith('880') ? digits.slice(3) : digits
  return local.startsWith('0') ? local : `0${local}`
}

/**
 * `status` is derived rather than read straight off the row, because an intent
 * that is still `open` in the database but past its expiry has not been swept
 * yet — and a buyer must not be shown a live countdown for a dead intent just
 * because a cron tick has not landed.
 */
function deriveStatus(
  status: string,
  expiresAt: Date,
  receivedCents: number,
  amountCents: number,
): PayView['status'] {
  if (status === 'matched' || status === 'paid') return 'matched'
  if (status === 'cancelled') return 'cancelled'
  if (status === 'expired') return 'expired'
  if (expiresAt.getTime() <= Date.now()) return 'expired'
  if (receivedCents > 0 && receivedCents < amountCents) return 'partial'
  return 'open'
}

export async function getPayView(publicId: string): Promise<PayView | null> {
  const uuid = fromPublicId('intent', publicId)
  if (!uuid) return null

  const [row] = await db
    .select({
      id: paymentIntents.id,
      status: paymentIntents.status,
      amountCents: paymentIntents.amountCents,
      receivedAmountCents: paymentIntents.receivedAmountCents,
      expiresAt: paymentIntents.expiresAt,
      returnUrl: paymentIntents.returnUrl,
      cancelUrl: paymentIntents.cancelUrl,
      refCode: paymentRefs.code,
      provider: receivingAccounts.provider,
      msisdn: receivingAccounts.msisdn,
      merchantName: apps.name,
      allowedRedirectHosts: apps.allowedRedirectHosts,
    })
    .from(paymentIntents)
    .innerJoin(receivingAccounts, eq(receivingAccounts.id, paymentIntents.receivingAccountId))
    .innerJoin(apps, eq(apps.id, paymentIntents.appId))
    .leftJoin(paymentRefs, eq(paymentRefs.intentId, paymentIntents.id))
    .where(eq(paymentIntents.id, uuid))
    .limit(1)

  if (!row) return null

  const applied = await db
    .select({
      trxId: incomingPayments.trxId,
      amountCents: orderPayments.appliedCents,
      appliedAt: orderPayments.appliedAt,
    })
    .from(orderPayments)
    .innerJoin(incomingPayments, eq(incomingPayments.id, orderPayments.incomingPaymentId))
    .where(and(eq(orderPayments.intentId, row.id), isNull(orderPayments.reversedAt)))
    .orderBy(asc(orderPayments.appliedAt))

  const methods = await listCheckoutMethods(row.id)
  const hosts = row.allowedRedirectHosts ?? []

  return {
    id: publicId,
    status: deriveStatus(row.status, row.expiresAt, row.receivedAmountCents, row.amountCents),
    provider: row.provider as 'bkash' | 'nagad',
    receivingMsisdn: toLocalMsisdn(row.msisdn),
    merchantName: row.merchantName,
    amountCents: row.amountCents,
    receivedAmountCents: row.receivedAmountCents,
    shortfallCents: Math.max(0, row.amountCents - row.receivedAmountCents),
    refCode: row.refCode,
    payments: applied.map((payment) => ({
      trxId: payment.trxId,
      amountCents: payment.amountCents,
      appliedAt: payment.appliedAt.toISOString(),
    })),
    methods,
    // A single applied payment pins the receiving account, because the matcher
    // gates on it — see switchCheckoutMethod.
    canSwitchMethod: applied.length === 0 && row.status === 'open',
    expiresAt: row.expiresAt.toISOString(),
    returnUrl: safeRedirect(row.returnUrl, hosts),
    cancelUrl: safeRedirect(row.cancelUrl, hosts),
  }
}
