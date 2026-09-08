import { randomBytes, randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db, pool } from '@/lib/db/client'
import { businesses, devices, users } from '@/lib/db/schema'
import { createPhoneProvisioning } from '@/lib/services/devices'
import { addAccountFromSim, listSimOptions } from '@/lib/services/sim-accounts'

/**
 * Setting up a phone, end to end, without anybody typing a phone number.
 *
 * The old sequence was: type a bKash number into the dashboard, mint a QR for
 * it, scan that, then separately tell the app which SIM the number was on. Two
 * hand-entered facts that had to agree, with nothing checking they did.
 *
 * The new one is: mint a QR for the *business*, scan it, and choose from the
 * SIMs the phone reports. Every step below is a real HTTP call against the
 * running server, because the parts most likely to drift are the seams — the
 * pairing route, the heartbeat, the command queue — and a test that called the
 * services directly would not touch any of them.
 *
 * ## Needs a dev server
 *
 * Unlike its neighbours, which only need Postgres. It skips rather than fails
 * when nothing is listening, because a red suite that means "you did not start
 * the server" teaches people to ignore red suites.
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
const CLIENT_IP = '10.9.0.142'

let serverUp = false
let businessId: string
let actorId: string

async function reachable(): Promise<boolean> {
  try {
    const response = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(3000) })
    return response.ok
  } catch {
    return false
  }
}

/** The SIMs a phone would report: one that knows its number, one that does not. */
const SIMS = [
  {
    subscription_id: 1,
    slot_index: 0,
    carrier_name: 'Grameenphone',
    display_name: 'GP',
    msisdn: '8801714205878',
    number_source: 'ims',
    network_generation: '4G',
  },
  {
    subscription_id: 2,
    slot_index: 1,
    carrier_name: 'Robi',
    display_name: 'Robi',
    msisdn: null,
    number_source: null,
    network_generation: '3G',
  },
]

beforeAll(async () => {
  serverUp = await reachable()
  if (!serverUp) return

  actorId = randomUUID()
  await db.insert(users).values({ id: actorId, name: 'Flow', email: `${actorId}@test.local` })

  const [business] = await db
    .insert(businesses)
    .values({
      name: 'Flow Shop',
      slug: `flow-${randomBytes(4).toString('hex')}`,
      status: 'active',
    })
    .returning({ id: businesses.id })
  businessId = business?.id ?? ''
})

afterAll(async () => {
  if (serverUp) {
    await db.delete(devices).where(eq(devices.businessId, businessId))
    await db.delete(businesses).where(eq(businesses.id, businessId))
    await db.delete(users).where(eq(users.id, actorId))
  }
  await pool.end()
})

describe('setting a phone up from a business code', () => {
  it('gets from a blank phone to a watched number with nothing typed', async () => {
    if (!serverUp) {
      console.warn(`  skipped: no server at ${BASE} — run \`pnpm dev\``)
      return
    }

    /* 1. The dashboard mints a code for the business. No number exists yet. */
    const qr = await createPhoneProvisioning({ businessId, actorId })
    const code = qr.payload.pair_url.split('/pair/')[1]
    expect(code).toBeTruthy()

    /* 2. The phone scans it and learns which merchant it now helps. */
    const paired = await (
      await fetch(`${BASE}/device/v1/pair`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': CLIENT_IP },
        body: JSON.stringify({ code, device_name: 'Counter phone' }),
      })
    ).json()

    expect(paired.business?.name).toBe('Flow Shop')
    // The state the old schema could not express: paired, with no number.
    expect(paired.account).toBeNull()

    // The dashboard approves it, as it does for any pairing.
    await db.update(devices).set({ status: 'active' }).where(eq(devices.id, paired.device_id))

    /* 3. The phone reports its SIMs on the heartbeat. */
    const beat = () =>
      fetch(`${BASE}/device/v1/heartbeat`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${paired.device_token}`,
          'x-device-id': paired.device_id,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ battery: 80, network: 'wifi', queue_depth: 0, sims: SIMS }),
      })

    expect((await beat()).status).toBe(200)

    /* 4. The dashboard sees them, with the unusable one explained. */
    const options = await listSimOptions({ businessId, deviceId: paired.device_id })
    expect(options?.sims).toHaveLength(2)
    expect(options?.sims[0]?.blockedReason).toBeNull()
    expect(options?.sims[1]?.blockedReason).toMatch(/does not report its own number/i)

    /* 5. Somebody picks the usable one. The number comes off the SIM. */
    const added = await addAccountFromSim({
      businessId,
      deviceId: paired.device_id,
      subscriptionId: 1,
      provider: 'bkash',
      actorId,
    })
    expect(added.msisdn).toBe(SIMS[0]?.msisdn)

    /* 6. The next beat carries the instruction — and no credential. */
    const withCommand = await (await beat()).json()
    const command = withCommand.commands?.[0]
    expect(command?.type).toBe('add_account')
    expect(command?.msisdn).toBe(SIMS[0]?.msisdn)
    // The whole security property of this path in one assertion.
    expect(JSON.stringify(command)).not.toMatch(/jmd_/)

    /* 7. The phone redeems it exactly as it redeems a scanned code. */
    const claimed = await (
      await fetch(`${BASE}/device/v1/pair`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': CLIENT_IP },
        body: JSON.stringify({
          code: command.pair_url.split('/pair/')[1],
          device_name: 'Counter phone',
        }),
      })
    ).json()

    expect(claimed.device_token).toBeTruthy()
    expect(claimed.account?.msisdn).toBe(SIMS[0]?.msisdn)
    expect(claimed.account?.provider).toBe('bkash')
  })
})
