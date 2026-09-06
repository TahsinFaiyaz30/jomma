import { randomBytes, randomUUID } from 'node:crypto'
import type { SimCard } from '@jomma/shared'
import { and, eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db, pool } from '@/lib/db/client'
import { businesses, devices, receivingAccounts, users } from '@/lib/db/schema'
import { addAccountFromSim, listSimOptions } from '@/lib/services/sim-accounts'

/**
 * Adding a number by choosing the SIM it lives on.
 *
 * What this replaces: somebody typed a bKash number into the dashboard, a QR
 * was generated for it, a phone scanned that, and then separately somebody told
 * the app which SIM the number was on. Two hand-entered facts that had to agree
 * with nothing checking they did — and when they disagreed, messages routed to
 * the wrong account or to none, with no symptom but payments not arriving.
 *
 * So the cases that matter here are the ones where the phone and the screen
 * could fall out of step: a SIM that has been pulled since the list was drawn,
 * a SIM that will not say what number it is, and a number already in use.
 */

let businessId: string
let deviceId: string
let actorId: string
const createdAccounts: string[] = []

const sim = (overrides: Partial<SimCard> = {}): SimCard => ({
  subscription_id: 1,
  slot_index: 0,
  carrier_name: 'Grameenphone',
  display_name: 'GP',
  /*
   * A real operator prefix, not just eleven digits. `canonicalMsisdn` requires
   * `01[3-9]`, so a fixture built from raw random digits fails validation about
   * a third of the time and the failure reads as a broken service.
   */
  msisdn: `88017${randomBytes(8).toString('hex').replace(/\D/g, '').padEnd(8, '4').slice(0, 8)}`,
  number_source: 'ims',
  network_generation: '4G',
  ...overrides,
})

async function setSims(sims: SimCard[]) {
  await db.update(devices).set({ sims, simsReportedAt: new Date() }).where(eq(devices.id, deviceId))
}

beforeAll(async () => {
  actorId = randomUUID()
  await db.insert(users).values({ id: actorId, name: 'SIM', email: `${actorId}@test.local` })

  const slug = `sim-${randomBytes(4).toString('hex')}`
  const [business] = await db
    .insert(businesses)
    .values({ name: 'SIM shop', slug, status: 'active' })
    .returning({ id: businesses.id })
  businessId = business?.id ?? ''

  // A phone paired to the business with no number bound to it — exactly the
  // state the new pairing flow produces and the old schema could not express.
  const [device] = await db
    .insert(devices)
    .values({ businessId, name: 'Counter phone', status: 'active' })
    .returning({ id: devices.id })
  deviceId = device?.id ?? ''
})

afterAll(async () => {
  await db.delete(devices).where(eq(devices.businessId, businessId))
  if (createdAccounts.length > 0) {
    await db.delete(receivingAccounts).where(inArray(receivingAccounts.id, createdAccounts))
  }
  await db.delete(businesses).where(eq(businesses.id, businessId))
  await db.delete(users).where(eq(users.id, actorId))
  await pool.end()
})

describe('listSimOptions', () => {
  it('offers a SIM that knows its own number', async () => {
    const card = sim()
    await setSims([card])

    const result = await listSimOptions({ businessId, deviceId })
    expect(result?.sims).toHaveLength(1)
    expect(result?.sims[0]?.blockedReason).toBeNull()
  })

  it('shows a SIM that will not say, rather than hiding it', async () => {
    /*
     * The ordinary failure on a carrier that never wrote the number. Omitting
     * the row would leave somebody comparing the screen against the SIM tray in
     * their hand with no way to find out why one is missing.
     */
    await setSims([sim({ msisdn: null, number_source: null })])

    const result = await listSimOptions({ businessId, deviceId })
    expect(result?.sims).toHaveLength(1)
    expect(result?.sims[0]?.blockedReason).toMatch(/does not report its own number/i)
  })

  it('refuses a phone that belongs to another business', async () => {
    expect(await listSimOptions({ businessId: randomUUID(), deviceId })).toBeNull()
  })
})

describe('addAccountFromSim', () => {
  it('takes the number from the SIM and queues the phone to claim it', async () => {
    const card = sim({ subscription_id: 11 })
    await setSims([card])

    const added = await addAccountFromSim({
      businessId,
      deviceId,
      subscriptionId: 11,
      provider: 'bkash',
      actorId,
    })
    createdAccounts.push(added.accountId)

    // The number is the SIM's, not anything a person typed.
    expect(added.msisdn).toBe(card.msisdn)

    const account = await db.query.receivingAccounts.findFirst({
      where: eq(receivingAccounts.id, added.accountId),
    })
    expect(account?.businessId).toBe(businessId)
    expect(account?.provider).toBe('bkash')

    /*
     * The credential is not in the command. A pairing URL is, and the phone
     * redeems it the same way it redeems a scanned code — so the token is
     * issued to whoever holds the handset over a path that is already
     * single-use and expiring.
     */
    const phone = await db.query.devices.findFirst({ where: eq(devices.id, deviceId) })
    const queued = (phone?.pendingCommands ?? []).at(-1)
    expect(queued?.type).toBe('add_account')
    expect(queued).toMatchObject({ msisdn: card.msisdn, provider: 'bkash' })
    expect(JSON.stringify(queued)).not.toMatch(/jmd_/)
  })

  it('appends to the queue rather than replacing it', async () => {
    // A rotation the phone has not collected yet must survive. Overwriting it
    // would leave that device holding a token the server has already replaced.
    await db
      .update(devices)
      .set({ pendingCommands: [{ type: 'rotate_token' }] })
      .where(eq(devices.id, deviceId))

    const card = sim({ subscription_id: 12 })
    await setSims([card])
    const added = await addAccountFromSim({
      businessId,
      deviceId,
      subscriptionId: 12,
      provider: 'nagad',
      actorId,
    })
    createdAccounts.push(added.accountId)

    const phone = await db.query.devices.findFirst({ where: eq(devices.id, deviceId) })
    expect(phone?.pendingCommands?.map((c) => c.type)).toEqual(['rotate_token', 'add_account'])
  })

  it('refuses a SIM that has been pulled since the list was drawn', async () => {
    // Heartbeats are minutes apart, so the screen is always slightly behind the
    // tray. The subscription id also arrives from a browser and is a claim.
    await setSims([sim({ subscription_id: 1 })])
    await expect(
      addAccountFromSim({ businessId, deviceId, subscriptionId: 999, provider: 'bkash', actorId }),
    ).rejects.toThrow(/no longer in the phone/i)
  })

  it('refuses a SIM that does not know its own number', async () => {
    await setSims([sim({ subscription_id: 21, msisdn: null, number_source: null })])
    await expect(
      addAccountFromSim({ businessId, deviceId, subscriptionId: 21, provider: 'bkash', actorId }),
    ).rejects.toThrow(/does not report its own number/i)
  })

  it('refuses a phone paired to a different business', async () => {
    await setSims([sim({ subscription_id: 31 })])
    await expect(
      addAccountFromSim({
        businessId: randomUUID(),
        deviceId,
        subscriptionId: 31,
        provider: 'bkash',
        actorId,
      }),
    ).rejects.toThrow(/not paired to this business/i)
  })

  it('refuses a second account for a provider the business is already trading on', async () => {
    /*
     * "Already has" means already *trading*, not merely present. A new account
     * is created `disabled` — checkout must not route to a number before a
     * phone is watching it — and a disabled account is a retired one, which
     * must not block the number that replaces it. So the rule bites on active
     * and degraded, which is also exactly what the unique index covers.
     */
    const first = await db.query.receivingAccounts.findFirst({
      where: and(
        eq(receivingAccounts.businessId, businessId),
        eq(receivingAccounts.provider, 'bkash'),
      ),
    })
    await db
      .update(receivingAccounts)
      .set({ status: 'active' })
      .where(eq(receivingAccounts.id, first?.id ?? ''))

    await setSims([sim({ subscription_id: 41 })])
    await expect(
      addAccountFromSim({ businessId, deviceId, subscriptionId: 41, provider: 'bkash', actorId }),
    ).rejects.toThrow(/already has a bkash number/i)
  })

  it('allows a replacement once the old number is disabled', async () => {
    // Changing numbers is ordinary, and the rule must not stand in the way of
    // it — otherwise a merchant whose SIM was stolen cannot recover.
    await db
      .update(receivingAccounts)
      .set({ status: 'disabled' })
      .where(
        and(eq(receivingAccounts.businessId, businessId), eq(receivingAccounts.provider, 'bkash')),
      )

    await setSims([sim({ subscription_id: 42 })])
    const added = await addAccountFromSim({
      businessId,
      deviceId,
      subscriptionId: 42,
      provider: 'bkash',
      actorId,
    })
    createdAccounts.push(added.accountId)
    expect(added.accountId).toBeTruthy()
  })
})
