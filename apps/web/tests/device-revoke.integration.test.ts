import { randomBytes, randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db, pool } from '@/lib/db/client'
import { businesses, devices, notifierEvents, users } from '@/lib/db/schema'
import { approveDevice, createPhoneProvisioning } from '@/lib/services/devices'

/**
 * A phone handing its own credential back.
 *
 * Disconnecting a business on the handset used to be purely local: the pairing
 * was forgotten and the server was never told, so the dashboard went on listing
 * an active device that had stopped existing. The merchant's phone looked
 * healthy right up until they noticed nothing had arrived, and the only remedy
 * was for somebody to work out which row was a ghost and revoke it by hand.
 *
 * Letting a device do this is safe in a way that letting it do most things is
 * not: it is giving something up rather than taking something, and the only
 * credential it can destroy is the one it authenticated with.
 *
 * ## Needs a dev server
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
const CLIENT_IP = '10.9.0.80'

let serverUp = false
let businessId = ''
let actorId = ''

async function reachable() {
  try {
    return (await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(3000) })).ok
  } catch {
    return false
  }
}

/** A phone that has scanned and been approved: a working credential. */
async function connected() {
  const qr = await createPhoneProvisioning({ businessId, actorId })
  const paired = (await (
    await fetch(`${BASE}/device/v1/pair`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': CLIENT_IP },
      body: JSON.stringify({
        code: qr.payload.pair_url.split('/pair/')[1],
        device_name: 'Counter phone',
        install_id: randomUUID(),
      }),
    })
  ).json()) as { device_id: string; device_token: string }

  await approveDevice({ deviceId: paired.device_id, actorId })
  return paired
}

const revoke = (id: string, token: string) =>
  fetch(`${BASE}/device/v1/revoke`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': CLIENT_IP,
      authorization: `Bearer ${token}`,
      'x-device-id': id,
    },
    body: '{}',
  })

beforeAll(async () => {
  serverUp = await reachable()
  if (!serverUp) return

  actorId = randomUUID()
  await db.insert(users).values({ id: actorId, name: 'Revoke', email: `${actorId}@test.local` })
  const [b] = await db
    .insert(businesses)
    .values({ name: 'Revoke', slug: `revoke-${randomBytes(4).toString('hex')}`, status: 'active' })
    .returning({ id: businesses.id })
  businessId = b?.id ?? ''
})

afterAll(async () => {
  if (serverUp) {
    await db.delete(devices).where(eq(devices.businessId, businessId))
    await db.delete(businesses).where(eq(businesses.id, businessId))
    await db.delete(users).where(eq(users.id, actorId))
  }
  await pool.end()
})

describe('a phone disconnecting itself', () => {
  const skip = () => {
    if (!serverUp) console.warn(`  skipped: no server at ${BASE}`)
    return !serverUp
  }

  it('leaves the credential dead and the dashboard told', async () => {
    if (skip()) return
    const phone = await connected()

    expect((await revoke(phone.device_id, phone.device_token)).status).toBe(200)

    const row = await db.query.devices.findFirst({ where: eq(devices.id, phone.device_id) })
    expect(row?.status).toBe('revoked')
    // Not merely marked: the hash is gone, so a replayed token cannot verify.
    expect(row?.tokenHash).toBeNull()
    expect(row?.revokedAt).not.toBeNull()

    /*
     * And nothing queued for it. `stop` exists to tell a handset that is still
     * beating to stand down; one that revoked itself has already forgotten the
     * pairing and will never beat again, so the command would sit unread.
     */
    expect(row?.pendingCommands).toEqual([])

    // Distinguishable from an operator revoking it, because they are not the
    // same event to read about a week later.
    const alerts = await db
      .select({ detail: notifierEvents.detail })
      .from(notifierEvents)
      .where(eq(notifierEvents.deviceId, phone.device_id))
    expect(alerts.map((a) => a.detail)).toContain(
      'The phone disconnected itself from this business',
    )
  })

  it('cannot be replayed, because the token it used is gone', async () => {
    if (skip()) return
    const phone = await connected()

    expect((await revoke(phone.device_id, phone.device_token)).status).toBe(200)
    // The phone reads this as "already gone", which it is.
    expect((await revoke(phone.device_id, phone.device_token)).status).toBe(401)
  })

  it('refuses a caller with no credential at all', async () => {
    if (skip()) return
    const phone = await connected()

    expect((await revoke(phone.device_id, 'jmd_not_a_real_token')).status).toBe(401)

    // And the device is untouched, which is the half worth checking: a refusal
    // that still revoked would be worse than no endpoint.
    const row = await db.query.devices.findFirst({ where: eq(devices.id, phone.device_id) })
    expect(row?.status).toBe('active')
  })

  it('revokes only itself, leaving the phone reporting for other businesses', async () => {
    if (skip()) return
    // The case the whole feature is for: leaving one merchant is not leaving
    // the rest, and each credential is separate precisely so it can be.
    const first = await connected()
    const second = await connected()

    expect((await revoke(first.device_id, first.device_token)).status).toBe(200)

    const other = await db.query.devices.findFirst({ where: eq(devices.id, second.device_id) })
    expect(other?.status).toBe('active')
    expect(other?.tokenHash).not.toBeNull()
  })
})
