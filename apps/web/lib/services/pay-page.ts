import 'server-only'

import { fromPublicId, isBusinessLive } from '@jomma/shared'
import { and, asc, eq, isNull } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import {
  apps,
  businesses,
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
  /**
   * How much more than the asking price arrived, if any.
   *
   * `over` is a completed state — the ref code is consumed and
   * `payment.overpaid` has already fired — so the buyer is done. They are still
   * told, because being out of pocket and not knowing is worse than knowing.
   */
  excessCents: number

  provider: 'bkash' | 'nagad'
  /**
   * Local format, 01XXXXXXXXX — what the buyer types into bKash.
   *
   * Null when the merchant may not be paid. Nulled *here*, in the view, rather
   * than hidden by whatever renders it: this object is serialised into the
   * page's payload, so a component that simply declines to display the number
   * still ships it to the browser, where view-source finds it. Withholding has
   * to happen before it leaves the server.
   */
  receivingMsisdn: string | null
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
  /**
   * The store named a provider at creation, so there is no choice to offer.
   *
   * Distinct from `canSwitchMethod`, which is about timing. This one is about
   * authority: an integration that asked for bKash gets bKash, and showing the
   * buyer a picker they cannot act on is a step that wastes their time.
   */
  methodLocked: boolean

  /**
   * Whether the sender's number is already on record.
   *
   * A boolean, never the number itself: this view is public to anyone holding
   * the link, and the payer's phone number is not theirs to read.
   *
   * When it is true the page does not ask, which also settles a disagreement it
   * would otherwise have no good answer to — the write is once-only, so a buyer
   * typing a *different* number than the store recorded would have it quietly
   * discarded and then be flagged as a sender mismatch when they paid.
   */
  payerKnown: boolean

  /**
   * Whether this merchant may still be sent money.
   *
   * False once the platform has suspended, rejected or not yet approved them.
   * The approval gate is enforced on the API credential, which stops a merchant
   * in that state creating *new* intents — but the intents they already have
   * carry no credential at all. Their pay links keep working, and a page that
   * says "send Tk 500 to 01xxxxxxxxx" is soliciting money into an account the
   * platform has decided should not be trading.
   *
   * So the instructions are withheld rather than the page: money already sent
   * is still shown, and can still be claimed with a TrxID or asked back — a
   * buyer who paid ten minutes before the suspension needs all of that, and
   * hiding it would strand them with no way to even prove what happened.
   */
  acceptingPayments: boolean

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
  /*
   * `over` is a *completed* state, not a problem to solve. applyPayment sets it
   * when more arrived than was asked for: the reference code is consumed,
   * matchedAt is stamped and `payment.overpaid` has already gone to the store.
   * Missing it here left a buyer who paid too much looking at a page still
   * asking them to pay.
   */
  if (status === 'matched' || status === 'over' || status === 'paid') return 'matched'
  if (status === 'cancelled') return 'cancelled'
  if (status === 'expired') return 'expired'
  if (expiresAt.getTime() <= Date.now()) return 'expired'
  if (receivedCents > 0 && receivedCents < amountCents) return 'partial'
  return 'open'
}

/**
 * Whether this intent's merchant may still be sent money, by intent uuid.
 *
 * A narrow lookup for the buyer-facing writes that exist to help somebody pay —
 * choosing a method, declaring the number they will pay from, fetching the QR.
 * Withholding the instructions from the page is most of the job, but each of
 * those is a separate endpoint anyone holding the link can call directly, and a
 * suspension that only removes the number from a screen is a suspension that a
 * saved bookmark walks straight around.
 *
 * Deliberately not applied to reading status, claiming a TrxID or requesting a
 * refund. Those are how a buyer who already paid finds out where their money
 * went, and taking them away would punish the one person in this who has done
 * nothing wrong.
 */
export async function isAcceptingPayments(intentId: string): Promise<boolean> {
  const [row] = await db
    .select({ businessStatus: businesses.status })
    .from(paymentIntents)
    .innerJoin(apps, eq(apps.id, paymentIntents.appId))
    .innerJoin(businesses, eq(businesses.id, apps.businessId))
    .where(eq(paymentIntents.id, intentId))
    .limit(1)

  return row ? isBusinessLive(row.businessStatus) : false
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
      providerPreference: paymentIntents.providerPreference,
      payerMsisdn: paymentIntents.payerMsisdn,
      provider: receivingAccounts.provider,
      msisdn: receivingAccounts.msisdn,
      merchantName: apps.name,
      allowedRedirectHosts: apps.allowedRedirectHosts,
      businessStatus: businesses.status,
    })
    .from(paymentIntents)
    .innerJoin(receivingAccounts, eq(receivingAccounts.id, paymentIntents.receivingAccountId))
    .innerJoin(apps, eq(apps.id, paymentIntents.appId))
    .innerJoin(businesses, eq(businesses.id, apps.businessId))
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

  const accepting = isBusinessLive(row.businessStatus)
  // Nothing to choose between when none of them may be paid.
  const methods = accepting ? await listCheckoutMethods(row.id) : []
  const hosts = row.allowedRedirectHosts ?? []

  return {
    id: publicId,
    status: deriveStatus(row.status, row.expiresAt, row.receivedAmountCents, row.amountCents),
    provider: row.provider as 'bkash' | 'nagad',
    // Both nulled together: the number and the code are the instruction, and
    // half of one is no use to a buyer and no safer to publish.
    receivingMsisdn: accepting ? toLocalMsisdn(row.msisdn) : null,
    merchantName: row.merchantName,
    amountCents: row.amountCents,
    receivedAmountCents: row.receivedAmountCents,
    shortfallCents: Math.max(0, row.amountCents - row.receivedAmountCents),
    excessCents: Math.max(0, row.receivedAmountCents - row.amountCents),
    refCode: accepting ? row.refCode : null,
    payments: applied.map((payment) => ({
      trxId: payment.trxId,
      amountCents: payment.amountCents,
      appliedAt: payment.appliedAt.toISOString(),
    })),
    methods,
    // A single applied payment pins the receiving account, because the matcher
    // gates on it — see switchCheckoutMethod.
    canSwitchMethod: accepting && applied.length === 0 && row.status === 'open',
    acceptingPayments: accepting,
    methodLocked: row.providerPreference !== 'any',
    payerKnown: Boolean(row.payerMsisdn),
    expiresAt: row.expiresAt.toISOString(),
    returnUrl: safeRedirect(row.returnUrl, hosts),
    cancelUrl: safeRedirect(row.cancelUrl, hosts),
  }
}
