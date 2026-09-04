import 'server-only'

import type { Provider } from '@jomma/shared'
import { and, eq, isNull } from 'drizzle-orm'
import { ApiError } from '@/lib/api/errors'
import { db } from '@/lib/db/client'
import { amountLocks, orderPayments, paymentIntents } from '@/lib/db/schema'
import { PARSERS } from '@/lib/parsers'
import { listAccountHealth, reclaimExpiredLock, routableAccounts } from './accounts'
import { audit } from './audit'
import { isUniqueViolation } from './refs'

/**
 * Choosing how to pay, on Jomma's own page.
 *
 * The store creates an intent and Jomma allocates a receiving account
 * immediately, because the reference code and the amount lock both hang off
 * that account. So "pick a method" is not a choice made before routing — it is a
 * *re-route* of an intent that already exists, and that is the whole difficulty.
 *
 * Three rules make it safe:
 *
 * - Only when the store said `any`. A store that asked for bKash gets bKash; the
 *   buyer does not get to overrule an integration decision.
 * - Only while nothing has been received. Moving the receiving account under a
 *   part-paid intent would strand the money already sent, because the matcher
 *   gates on the account.
 * - Only to a provider whose parser actually works. Otherwise every payment on
 *   it lands in the manual queue and the buyer waits for a human.
 */

export interface CheckoutMethod {
  provider: Provider
  label: string
  /** Selectable right now. */
  available: boolean
  /**
   * Why not, when it is not. Shown to the buyer, so it says what they can do
   * about it rather than naming an internal state.
   */
  reason: string | null
  /** The one the intent is currently routed to. */
  selected: boolean
}

const LABELS: Record<Provider, string> = {
  bkash: 'bKash',
  nagad: 'Nagad',
}

/**
 * Methods this intent could actually be paid with, in the order to show them.
 *
 * Unavailable ones are returned rather than filtered out: a checkout that
 * silently shows one option leaves the buyer wondering whether the other exists,
 * and "Nagad — temporarily unavailable" is a better answer than nothing.
 */
export async function listCheckoutMethods(intentId: string): Promise<CheckoutMethod[]> {
  const intent = await db.query.paymentIntents.findFirst({
    where: eq(paymentIntents.id, intentId),
    with: { receivingAccount: true },
  })
  if (!intent) throw ApiError.notFound('No such payment.')

  const accounts = await listAccountHealth()
  const locked = intent.providerPreference !== 'any'
  const current = intent.receivingAccount.provider as Provider

  return (Object.keys(LABELS) as Provider[]).map((provider) => {
    const selected = provider === current
    const parser = PARSERS[provider]
    const routable = routableAccounts(accounts, provider)

    let reason: string | null = null
    if (!parser?.automatic) {
      // Deliberately vague to the buyer, specific in the code: we cannot read
      // this provider's messages yet, so a payment on it would sit in a queue.
      reason = 'Not available yet'
    } else if (routable.length === 0) {
      reason = 'Temporarily unavailable'
    } else if (locked && !selected) {
      reason = `This order is set up for ${LABELS[current]}`
    }

    return {
      provider,
      label: LABELS[provider],
      available: selected || reason === null,
      reason: selected ? null : reason,
      selected,
    }
  })
}

/**
 * Move an open, unpaid intent to a different provider.
 *
 * The reference code survives — it belongs to the intent, not the account — so a
 * buyer who already wrote the code down does not have to start again. The lock
 * does not: it is keyed on (account, amount) and has to be released on the old
 * account and taken on the new one, which can fail if another buyer is mid-flow
 * for the same amount there.
 */
export async function switchCheckoutMethod(options: {
  intentId: string
  provider: Provider
  requestId?: string
}): Promise<{ changed: boolean }> {
  const parser = PARSERS[options.provider]
  if (!parser?.automatic) {
    throw ApiError.noCapacity(`${LABELS[options.provider]} is not available yet.`)
  }

  const intent = await db.query.paymentIntents.findFirst({
    where: eq(paymentIntents.id, options.intentId),
    with: { receivingAccount: true },
  })
  if (!intent) throw ApiError.notFound('No such payment.')

  if (intent.receivingAccount.provider === options.provider) return { changed: false }

  if (intent.status !== 'open') {
    throw ApiError.noCapacity('This payment can no longer be changed.')
  }
  if (intent.providerPreference !== 'any') {
    throw ApiError.noCapacity('The store chose the payment method for this order.')
  }

  /*
   * Received money pins the account. The matcher gates on the receiving account,
   * so re-routing a part-paid intent would leave the first payment attached to
   * an account the intent no longer points at.
   */
  const received = await db.query.orderPayments.findFirst({
    where: and(eq(orderPayments.intentId, intent.id), isNull(orderPayments.reversedAt)),
  })
  if (received) {
    throw ApiError.noCapacity(
      'Part of this payment has already arrived; finish on the same method.',
    )
  }

  const accounts = await listAccountHealth()
  const eligible = routableAccounts(accounts, options.provider)
  if (eligible.length === 0) throw ApiError.noHealthyAccount()

  for (const account of eligible) {
    try {
      await db.transaction(async (tx) => {
        const now = new Date()

        // Release the old claim first, so switching back and forth does not
        // leave the buyer holding two locks at the same amount.
        await tx
          .update(amountLocks)
          .set({ status: 'released' })
          .where(and(eq(amountLocks.intentId, intent.id), eq(amountLocks.status, 'active')))

        await reclaimExpiredLock(tx, account.id, intent.amountCents, now)

        await tx.insert(amountLocks).values({
          receivingAccountId: account.id,
          amountCents: intent.amountCents,
          intentId: intent.id,
          status: 'active',
          expiresAt: intent.expiresAt,
        })

        await tx
          .update(paymentIntents)
          .set({ receivingAccountId: account.id })
          .where(eq(paymentIntents.id, intent.id))

        await audit(tx, {
          action: 'intent.rerouted',
          actorType: 'client',
          appId: intent.appId,
          intentId: intent.id,
          requestId: options.requestId ?? null,
          payload: {
            from: intent.receivingAccount.provider,
            to: options.provider,
            receiving_account_id: account.id,
          },
        })
      })

      return { changed: true }
    } catch (error) {
      // Another buyer holds this amount on this account. Try the next one.
      if (isUniqueViolation(error)) continue
      throw error
    }
  }

  throw ApiError.noHealthyAccount()
}
