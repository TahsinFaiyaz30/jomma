import { randomBytes } from 'node:crypto'
import { toPublicId } from '@jomma/shared'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db, pool } from '@/lib/db/client'
import { apps, businesses, paymentIntents, paymentRefs, receivingAccounts } from '@/lib/db/schema'
import { getPayView, isAcceptingPayments } from '@/lib/services/pay-page'

/**
 * What a buyer is shown once the platform has stopped the merchant.
 *
 * The approval gate lives on the API credential, so a suspended merchant cannot
 * create new intents. The ones they already have carry no credential at all —
 * the pay link is public by design — so those pages kept working and kept
 * saying "send Tk 500 to 01xxxxxxxxx", which is soliciting money into an
 * account the platform has decided should not be trading.
 *
 * The rule is narrow on purpose, and both halves are pinned here. The
 * instruction is withheld; everything that helps somebody who *already* sent
 * money is not, because taking that away would punish the one person involved
 * who has done nothing wrong.
 */

let business: string
let account: string
let intentId: string
let publicId: string
const refCode = randomBytes(4).toString('hex').toUpperCase()

async function setStatus(status: 'active' | 'pending' | 'suspended' | 'rejected') {
  await db.update(businesses).set({ status }).where(eq(businesses.id, business))
}

beforeAll(async () => {
  const slug = `susp-${randomBytes(4).toString('hex')}`
  const [row] = await db
    .insert(businesses)
    .values({ name: 'Suspendable', slug, status: 'active' })
    .returning({ id: businesses.id })
  business = row?.id ?? ''

  const [app] = await db
    .insert(apps)
    .values({ businessId: business, name: 'Shop', slug: `${slug}-app` })
    .returning({ id: apps.id })

  const [acct] = await db
    .insert(receivingAccounts)
    .values({
      businessId: business,
      provider: 'bkash',
      msisdn: `8801${randomBytes(5).toString('hex').replace(/\D/g, '').padEnd(9, '7').slice(0, 9)}`,
      label: 'phone',
    })
    .returning({ id: receivingAccounts.id })
  account = acct?.id ?? ''

  const [intent] = await db
    .insert(paymentIntents)
    .values({
      appId: app?.id ?? '',
      receivingAccountId: account,
      amountCents: 50_000,
      clientReference: `SUS-${randomBytes(3).toString('hex')}`,
      ttlSeconds: 900,
      expiresAt: new Date(Date.now() + 900_000),
    })
    .returning({ id: paymentIntents.id })
  intentId = intent?.id ?? ''
  publicId = toPublicId('intent', intentId)

  await db
    .insert(paymentRefs)
    .values({ intentId, code: refCode, expiresAt: new Date(Date.now() + 900_000) })
})

afterAll(async () => {
  await db.delete(paymentIntents).where(eq(paymentIntents.receivingAccountId, account))
  await db.delete(businesses).where(eq(businesses.id, business))
  await pool.end()
})

describe('while the merchant is active', () => {
  it('hands the buyer everything they need to pay', async () => {
    await setStatus('active')
    const view = await getPayView(publicId)

    expect(view?.acceptingPayments).toBe(true)
    expect(view?.receivingMsisdn).toBeTruthy()
    expect(view?.refCode).toBe(refCode)
    expect(await isAcceptingPayments(intentId)).toBe(true)
  })
})

describe.each(['suspended', 'rejected', 'pending'] as const)('once %s', (status) => {
  it('withholds the number and the reference, which are the instruction', async () => {
    await setStatus(status)
    const view = await getPayView(publicId)

    // Nulled in the view rather than hidden by the component that renders it:
    // this object is serialised into the page payload, so a component that
    // merely declines to display the number still ships it to the browser.
    expect(view?.receivingMsisdn).toBeNull()
    expect(view?.refCode).toBeNull()
    expect(view?.acceptingPayments).toBe(false)
  })

  it('offers no method to switch to', async () => {
    await setStatus(status)
    const view = await getPayView(publicId)

    expect(view?.methods).toEqual([])
    expect(view?.canSwitchMethod).toBe(false)
  })

  it('refuses the writes that exist to help somebody pay', async () => {
    await setStatus(status)
    expect(await isAcceptingPayments(intentId)).toBe(false)
  })

  it('still shows the payment itself, so a buyer can see what they are owed', async () => {
    await setStatus(status)
    const view = await getPayView(publicId)

    // The page is withheld from, not taken away. Somebody who paid ten minutes
    // before the suspension needs the amount and the status to have any
    // conversation about it at all.
    expect(view).not.toBeNull()
    expect(view?.amountCents).toBe(50_000)
    expect(view?.merchantName).toBe('Shop')
    expect(view?.status).toBe('open')
  })
})

describe('when the suspension is lifted', () => {
  it('goes back to normal rather than staying broken', async () => {
    await setStatus('suspended')
    expect((await getPayView(publicId))?.receivingMsisdn).toBeNull()

    await setStatus('active')
    const view = await getPayView(publicId)
    expect(view?.receivingMsisdn).toBeTruthy()
    expect(view?.refCode).toBe(refCode)
  })
})

describe('an unknown intent', () => {
  it('is not accepting payments either, rather than defaulting open', async () => {
    // Fails closed: a lookup that found nothing must not read as permission.
    expect(await isAcceptingPayments('00000000-0000-7000-8000-000000000000')).toBe(false)
  })
})
