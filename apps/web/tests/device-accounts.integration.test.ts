import { randomBytes, randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db, pool } from '@/lib/db/client'
import { businesses, devices, receivingAccounts, users } from '@/lib/db/schema'
import { createPhoneProvisioning } from '@/lib/services/devices'

/**
 * A phone adding the numbers it is paid on.
 *
 * The handset is what gets approved: somebody at the dashboard looked at a
 * phone that had scanned a code and said yes to it. After that it manages the
 * numbers on its own business rather than asking for each one, which is the
 * point of holding it.
 *
 * So what these check is the boundary that approval draws — that an unapproved
 * phone is refused, that a phone cannot name a number it cannot see, and that
 * what it creates is `disabled` and therefore routes nothing until a human
 * enables it.
 *
 * ## Needs a dev server
 *
 * Skips rather than fails when nothing is listening.
 */

const BASE = process.env.JOMMA_URL ?? 'http://localhost:3000'

/*
 * One client address per file, so the suite does not throttle itself.
 *
 * Pairing is rate limited by IP — it must be, since a phone redeeming a code
 * has no identity yet — and every test here calls it from the same machine. Run
 * on their own the files stay under the limit; run together they share one
 * bucket and the later ones get a 429, which surfaced as "that phone is not
 * waiting for approval" from a test whose pairing had silently been refused.
 *
 * Faking the header is not weakening the check: a real deployment sits behind a
 * proxy that sets it, and each of these files stands for a different phone.
 */
const CLIENT_IP = '10.9.0.106'

let serverUp = false
let businessId = ''
let actorId = ''
let token = ''
let deviceId = ''

const SIMS = [
  {
    subscription_id: 1,
    slot_index: 0,
    carrier_name: 'Grameenphone',
    display_name: 'GP',
    /*
     * A real operator prefix. `normalizeMsisdn` requires `01[3-9]`, and this
     * one goes through `createReceivingAccount` rather than being inserted
     * directly — so a fixture built from raw random digits is rejected as "not
     * a Bangladeshi mobile number", which reads as a broken endpoint.
     */
    msisdn: `88017${randomBytes(8).toString('hex').replace(/\D/g, '').padEnd(8, '4').slice(0, 8)}`,
    number_source: 'ims',
    network_generation: '4G',
  },
]

async function reachable() {
  try {
    return (await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(3000) })).ok
  } catch {
    return false
  }
}

const asDevice = (method: string, body?: unknown) =>
  fetch(`${BASE}/device/v1/accounts`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      'x-device-id': deviceId,
      'content-type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

beforeAll(async () => {
  serverUp = await reachable()
  if (!serverUp) return

  actorId = randomUUID()
  await db.insert(users).values({ id: actorId, name: 'Dev', email: `${actorId}@test.local` })
  const [b] = await db
    .insert(businesses)
    .values({ name: 'Dev', slug: `dev-${randomBytes(4).toString('hex')}`, status: 'active' })
    .returning({ id: businesses.id })
  businessId = b?.id ?? ''

  const qr = await createPhoneProvisioning({ businessId, actorId })
  const paired = await (
    await fetch(`${BASE}/device/v1/pair`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': CLIENT_IP },
      body: JSON.stringify({
        code: qr.payload.pair_url.split('/pair/')[1],
        device_name: 'Counter',
      }),
    })
  ).json()

  token = paired.device_token
  deviceId = paired.device_id
})

afterAll(async () => {
  if (serverUp) {
    await db.delete(devices).where(eq(devices.businessId, businessId))
    await db.delete(receivingAccounts).where(eq(receivingAccounts.businessId, businessId))
    await db.delete(businesses).where(eq(businesses.id, businessId))
    await db.delete(users).where(eq(users.id, actorId))
  }
  await pool.end()
})

describe('a phone managing its own numbers', () => {
  const skip = () => {
    if (!serverUp) console.warn(`  skipped: no server at ${BASE}`)
    return !serverUp
  }

  it('refuses a phone that has not been approved', async () => {
    if (skip()) return
    // The trust boundary. Scanning a code earns nothing on its own — and it is
    // 403 rather than 401 on purpose: the credential is real, it is the phone
    // that is not allowed yet, and telling those apart is what lets the app say
    // "waiting for approval" instead of "your token is wrong".
    expect((await asDevice('POST', { subscription_id: 1, provider: 'bkash' })).status).toBe(403)
  })

  it('lets an approved phone list the SIMs it reported', async () => {
    if (skip()) return
    await db.update(devices).set({ status: 'active' }).where(eq(devices.id, deviceId))
    await fetch(`${BASE}/device/v1/heartbeat`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'x-device-id': deviceId,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ battery: 90, network: 'wifi', queue_depth: 0, sims: SIMS }),
    })

    const body = await (await asDevice('GET')).json()
    expect(body.sims).toHaveLength(1)
    expect(body.sims[0].msisdn).toBe(SIMS[0]?.msisdn)
  })

  it('adds a number the SIM reports, disabled', async () => {
    if (skip()) return
    const response = await asDevice('POST', { subscription_id: 1, provider: 'bkash' })
    const body = await response.json()

    expect(response.status, JSON.stringify(body)).toBe(201)
    expect(body.msisdn).toBe(SIMS[0]?.msisdn)

    // Disabled is what bounds a stolen token: it routes nothing until a human
    // turns it on.
    const account = await db.query.receivingAccounts.findFirst({
      where: eq(receivingAccounts.msisdn, SIMS[0]?.msisdn ?? ''),
    })
    expect(account?.status).toBe('disabled')
    expect(account?.businessId).toBe(businessId)
  })

  it('allows the same number for a second provider', async () => {
    if (skip()) return
    // The whole point of the index change: one SIM, two wallets.
    const response = await asDevice('POST', { subscription_id: 1, provider: 'nagad' })
    expect(response.status, JSON.stringify(await response.clone().json())).toBe(201)

    const both = await db
      .select({ provider: receivingAccounts.provider })
      .from(receivingAccounts)
      .where(eq(receivingAccounts.msisdn, SIMS[0]?.msisdn ?? ''))
    expect(both.map((r) => r.provider).sort()).toEqual(['bkash', 'nagad'])
  })

  it('refuses a subscription this phone never reported', async () => {
    if (skip()) return
    // The body names a subscription, never a number, so a phone cannot claim
    // one it cannot see.
    const response = await asDevice('POST', { subscription_id: 999, provider: 'bkash' })
    expect(response.status).toBe(422)
    expect((await response.json()).error.message).toMatch(/no longer in the phone/i)
  })
})
