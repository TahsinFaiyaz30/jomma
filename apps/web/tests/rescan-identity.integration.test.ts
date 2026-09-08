import { randomBytes, randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db, pool } from '@/lib/db/client'
import { businesses, devices, users } from '@/lib/db/schema'
import { createPhoneProvisioning } from '@/lib/services/devices'
import { getSetupState } from '@/lib/services/onboarding'

/**
 * Scanning again replaces, rather than piling up.
 *
 * Every "Show pairing code" mints a device row and every scan turns one into
 * `awaiting_approval`. Somebody who pressed it a few times — a code expired, or
 * the first scan did not appear to do anything — ended up with the same handset
 * listed six times, each with its own approve and decline, and nothing saying
 * which one was live.
 *
 * Keyed on the app's `installId` and not on the name. Names are cosmetic and
 * two phones can share one, so matching on them would retire a different
 * handset that happened to be called the same thing — which is why these tests
 * pair phones that share a name deliberately.
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
const CLIENT_IP = '10.9.0.25'

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

/** Mint a code and redeem it, exactly as a phone does. */
async function scan(installId?: string, name = 'HONOR DNP-NX9') {
  const qr = await createPhoneProvisioning({ businessId, actorId })
  const response = await fetch(`${BASE}/device/v1/pair`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': CLIENT_IP },
    body: JSON.stringify({
      code: qr.payload.pair_url.split('/pair/')[1],
      device_name: name,
      ...(installId ? { install_id: installId } : {}),
    }),
  })
  return response.json()
}

const waiting = () =>
  db
    .select({ id: devices.id })
    .from(devices)
    .where(and(eq(devices.businessId, businessId), eq(devices.status, 'awaiting_approval')))

beforeAll(async () => {
  serverUp = await reachable()
  if (!serverUp) return

  actorId = randomUUID()
  await db.insert(users).values({ id: actorId, name: 'Rescan', email: `${actorId}@test.local` })
  const [b] = await db
    .insert(businesses)
    .values({ name: 'Rescan', slug: `rescan-${randomBytes(4).toString('hex')}`, status: 'active' })
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

describe('one waiting record per handset', () => {
  const skip = () => {
    if (!serverUp) console.warn(`  skipped: no server at ${BASE}`)
    return !serverUp
  }

  it('replaces the earlier attempt when the same phone scans again', async () => {
    if (skip()) return
    const install = randomUUID()

    const first = await scan(install)
    await scan(install)
    const third = await scan(install)

    const rows = await waiting()
    expect(rows).toHaveLength(1)
    expect(rows[0]?.id).toBe(third.device_id)

    // And the superseded credential is genuinely dead, not merely hidden.
    const old = await db.query.devices.findFirst({ where: eq(devices.id, first.device_id) })
    expect(old?.status).toBe('revoked')
    expect(old?.tokenHash).toBeNull()
  })

  it('shows one phone to the wizard, not three', async () => {
    if (skip()) return
    const state = await getSetupState(businessId)
    expect(state.pendingPhones).toHaveLength(1)
  })

  it('keeps a second handset that happens to share a name', async () => {
    if (skip()) return
    // The reason this is not keyed on the name. Two phones can be called the
    // same thing, and retiring one because of the other would be wrong.
    await scan(randomUUID(), 'HONOR DNP-NX9')

    expect(await waiting()).toHaveLength(2)
    expect((await getSetupState(businessId)).pendingPhones).toHaveLength(2)
  })

  it('leaves an older app that sends no id with the previous behaviour', async () => {
    if (skip()) return
    // Nothing to match on, so nothing is retired — a fresh row per scan, which
    // is what happened before any of this existed.
    const before = (await waiting()).length
    await scan(undefined)
    expect(await waiting()).toHaveLength(before + 1)
  })
})
