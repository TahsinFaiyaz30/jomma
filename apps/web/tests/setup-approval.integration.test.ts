import { randomBytes, randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db, pool } from '@/lib/db/client'
import { businesses, devices, users } from '@/lib/db/schema'
import { getSetupState } from '@/lib/services/onboarding'

/**
 * The gap between scanning a code and the wizard noticing.
 *
 * Approval is deliberate: a provisioning QR is a bearer credential, so a phone
 * that scans one lands `awaiting_approval` and captures nothing until somebody
 * says yes. `getSetupState` selected only `active` devices, so that phone was
 * invisible to the screen whose job is walking somebody through setup — the
 * wizard sat on "this checks itself every few seconds once you scan" while the
 * phone said it was waiting for an approval no screen offered. Neither side was
 * wrong on its own, and together they deadlocked.
 */

let businessId = ''
let actorId = ''

beforeAll(async () => {
  actorId = randomUUID()
  await db.insert(users).values({ id: actorId, name: 'Setup', email: `${actorId}@test.local` })
  const [b] = await db
    .insert(businesses)
    .values({ name: 'Setup', slug: `setup-${randomBytes(4).toString('hex')}`, status: 'active' })
    .returning({ id: businesses.id })
  businessId = b?.id ?? ''
})

afterAll(async () => {
  await db.delete(devices).where(eq(devices.businessId, businessId))
  await db.delete(businesses).where(eq(businesses.id, businessId))
  await db.delete(users).where(eq(users.id, actorId))
  await pool.end()
})

/** A phone that has redeemed its code: real token, waiting to be let in. */
async function scanned(status: 'awaiting_approval' | 'active') {
  await db.delete(devices).where(eq(devices.businessId, businessId))
  const [device] = await db
    .insert(devices)
    .values({
      businessId,
      name: 'Counter phone',
      status,
      provisionedAt: new Date(),
      tokenHash: `hash-${randomBytes(6).toString('hex')}`,
    })
    .returning({ id: devices.id })
  return device?.id ?? ''
}

describe('the first step of setup', () => {
  it('offers nothing to approve before a phone has scanned', async () => {
    const state = await getSetupState(businessId)

    expect(state.pendingDeviceId).toBeNull()
    expect(state.steps.find((s) => s.id === 'phone')?.done).toBe(false)
  })

  it('surfaces a phone that has scanned and is waiting', async () => {
    // The case that deadlocked. The step is still not done — approval is a real
    // step — but the wizard can now see the phone and act on it.
    const deviceId = await scanned('awaiting_approval')
    const state = await getSetupState(businessId)

    expect(state.pendingDeviceId).toBe(deviceId)
    expect(state.pendingDeviceName).toBe('Counter phone')
    expect(state.steps.find((s) => s.id === 'phone')?.done).toBe(false)
    expect(state.steps.find((s) => s.id === 'phone')?.detail).toMatch(/approve it below/i)
  })

  it('counts the phone once it is approved, and stops offering approval', async () => {
    await scanned('active')
    const state = await getSetupState(businessId)

    expect(state.pendingDeviceId).toBeNull()
    expect(state.steps.find((s) => s.id === 'phone')?.done).toBe(true)
    expect(state.firstDeviceId).not.toBeNull()
  })

  it('does not offer another business’s phone for approval', async () => {
    // `pendingDeviceId` is handed to a server action that approves whatever it
    // names, so it must never carry somebody else's device.
    await scanned('awaiting_approval')

    expect((await getSetupState(randomUUID())).pendingDeviceId).toBeNull()
  })
})
