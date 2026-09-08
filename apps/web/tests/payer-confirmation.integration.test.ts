import { randomBytes, randomUUID } from 'node:crypto'
import { toPublicId } from '@jomma/shared'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db, pool } from '@/lib/db/client'
import {
  apiKeys,
  apps,
  businesses,
  paymentIntents,
  receivingAccounts,
  users,
} from '@/lib/db/schema'
import { sameMsisdn } from '@/lib/matching/normalize'
import { getPayView } from '@/lib/services/pay-page'

/**
 * A store's guess is a suggestion; only the buyer's answer is an answer.
 *
 * The pay page used to skip the payer question whenever `payer_msisdn` was
 * non-null, which treated a store-supplied number as settled fact. It is not:
 * checkout collects a *delivery* phone, and money arrives from whoever is
 * paying — routinely a different person, a husband paying for a wife's order or
 * a shop paying for a customer. A wrong number there silently costs the
 * matching signal, and nothing in either system looks misconfigured.
 *
 * Both cases collapsed into one non-null column, which is why they could not be
 * told apart. `payer_msisdn_source` is what tells them apart now.
 *
 * ## Needs a dev server
 */

const BASE = process.env.JOMMA_URL ?? 'http://localhost:3000'

/*
 * One client address per file, so the suite does not throttle itself — the pay
 * endpoints are rate limited by IP, as they must be, since a buyer holds a link
 * rather than a credential.
 */
const CLIENT_IP = '10.9.0.211'

let serverUp = false
let businessId = ''
let accountId = ''
let appId = ''
let actorId = ''

async function reachable() {
  try {
    return (await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(3000) })).ok
  } catch {
    return false
  }
}

/** An open intent, optionally with the number a store guessed at checkout. */
async function intent(storeSupplied: string | null) {
  const [row] = await db
    .insert(paymentIntents)
    .values({
      appId,
      receivingAccountId: accountId,
      amountCents: 50_000,
      clientReference: `T-${randomBytes(4).toString('hex')}`,
      payerMsisdn: storeSupplied,
      payerMsisdnSource: storeSupplied ? 'store' : null,
      ttlSeconds: 900,
      expiresAt: new Date(Date.now() + 900_000),
    })
    .returning({ id: paymentIntents.id })
  return row!.id
}

const post = (id: string, path: string, body?: unknown) =>
  fetch(`${BASE}/api/pay/${toPublicId('intent', id)}/payer${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': CLIENT_IP },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })

const stored = async (id: string) =>
  db.query.paymentIntents.findFirst({ where: eq(paymentIntents.id, id) })

beforeAll(async () => {
  serverUp = await reachable()
  if (!serverUp) return

  actorId = randomUUID()
  await db.insert(users).values({ id: actorId, name: 'Payer', email: `${actorId}@test.local` })
  const slug = `payer-${randomBytes(4).toString('hex')}`
  const [b] = await db
    .insert(businesses)
    .values({ name: 'Payer', slug, status: 'active' })
    .returning({ id: businesses.id })
  businessId = b!.id

  const [a] = await db
    .insert(apps)
    .values({ businessId, name: 'Shop', slug: `${slug}-app` })
    .returning({ id: apps.id })
  appId = a!.id

  const [acc] = await db
    .insert(receivingAccounts)
    .values({
      businessId,
      provider: 'bkash',
      msisdn: `88018${randomBytes(8).toString('hex').replace(/\D/g, '').padEnd(8, '5').slice(0, 8)}`,
      label: 'test',
      status: 'active',
    })
    .returning({ id: receivingAccounts.id })
  accountId = acc!.id
})

afterAll(async () => {
  if (serverUp) {
    await db.delete(paymentIntents).where(eq(paymentIntents.appId, appId))
    await db.delete(apiKeys).where(eq(apiKeys.appId, appId))
    await db.delete(apps).where(eq(apps.businessId, businessId))
    await db.delete(receivingAccounts).where(eq(receivingAccounts.businessId, businessId))
    await db.delete(businesses).where(eq(businesses.id, businessId))
    await db.delete(users).where(eq(users.id, actorId))
  }
  await pool.end()
})

describe('a store-supplied payer number', () => {
  const skip = () => {
    if (!serverUp) console.warn(`  skipped: no server at ${BASE}`)
    return !serverUp
  }

  it('is offered for confirmation rather than treated as answered', async () => {
    if (skip()) return
    const id = await intent('8801712345878')

    const view = await getPayView(toPublicId('intent', id))
    expect(view?.payerConfirmed, 'nobody has confirmed it yet').toBe(false)
    // Masked, because this view is public to anyone holding the link — enough
    // to answer "is that you?", not enough to be worth harvesting.
    expect(view?.payerSuggestion).toBe('01712•••878')
    expect(view?.payerSuggestion).not.toContain('345')
  })

  it('is confirmed by the buyer without the number changing', async () => {
    if (skip()) return
    const id = await intent('8801712345878')

    expect((await post(id, '/confirm')).status).toBe(200)

    const row = await stored(id)
    // The number is untouched; only who vouched for it moved.
    expect(row?.payerMsisdn).toBe('8801712345878')
    expect(row?.payerMsisdnSource).toBe('buyer')

    const view = await getPayView(toPublicId('intent', id))
    expect(view?.payerConfirmed).toBe(true)
    // Nothing left to confirm, so nothing is echoed back.
    expect(view?.payerSuggestion).toBeNull()
  })

  it('can be corrected, which the old write-once guard forbade', async () => {
    if (skip()) return
    /*
     * The case that made this worth doing. The guard was "payer_msisdn is
     * null", so a store that supplied a delivery phone locked the buyer out of
     * fixing it — and that number is the one most likely to be wrong.
     */
    const id = await intent('8801712345878')

    expect((await post(id, '', { msisdn: '01898765432' })).status).toBe(200)

    const row = await stored(id)
    /*
     * Compared as numbers, not as strings. The column keeps whatever form it
     * was given — '01…' from a buyer, '880…' from a store — and the matcher
     * normalises both to the last ten digits before comparing, so asserting an
     * exact string here would pin a storage detail rather than the behaviour.
     */
    expect(sameMsisdn(row?.payerMsisdn, '01898765432')).toBe(true)
    expect(sameMsisdn(row?.payerMsisdn, '8801712345878'), 'the guess is gone').toBe(false)
    expect(row?.payerMsisdnSource).toBe('buyer')
  })
})

describe('what the buyer said stands', () => {
  const skip = () => !serverUp

  it('cannot be overwritten by anyone else holding the link', async () => {
    if (skip()) return
    /*
     * The half of write-once that must not move. A buyer's own answer is the
     * thing the guard was defending; a store's guess never was. The worst
     * anyone else can still do is win a race before the buyer answers.
     */
    const id = await intent(null)

    expect((await post(id, '', { msisdn: '01711111111' })).status).toBe(200)
    expect((await post(id, '', { msisdn: '01999999999' })).status).toBe(200)

    const row = await stored(id)
    expect(sameMsisdn(row?.payerMsisdn, '01711111111'), 'the first answer stands').toBe(true)
  })

  it('is not downgraded by a stray confirmation', async () => {
    if (skip()) return
    // Confirm only ever promotes a suggestion. With an answer already on
    // record there is no suggestion, so it must change nothing.
    const id = await intent(null)
    await post(id, '', { msisdn: '01711111111' })

    expect((await post(id, '/confirm')).status).toBe(200)

    const row = await stored(id)
    expect(sameMsisdn(row?.payerMsisdn, '01711111111')).toBe(true)
    expect(row?.payerMsisdnSource).toBe('buyer')
  })

  it('leaves an intent with nothing on record still asking', async () => {
    if (skip()) return
    const id = await intent(null)

    const view = await getPayView(toPublicId('intent', id))
    expect(view?.payerConfirmed).toBe(false)
    expect(view?.payerSuggestion).toBeNull()
  })
})
