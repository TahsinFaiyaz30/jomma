import { randomBytes, randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db, pool } from '@/lib/db/client'
import { businesses, devices, users } from '@/lib/db/schema'
import { revokeDevice } from '@/lib/services/devices'
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

    expect(state.pendingPhones).toHaveLength(0)
    expect(state.steps.find((s) => s.id === 'phone')?.done).toBe(false)
  })

  it('surfaces a phone that has scanned and is waiting', async () => {
    // The case that deadlocked. The step is still not done — approval is a real
    // step — but the wizard can now see the phone and act on it.
    const deviceId = await scanned('awaiting_approval')
    const state = await getSetupState(businessId)

    expect(state.pendingPhones.map((p) => p.id)).toEqual([deviceId])
    expect(state.pendingPhones[0]?.name).toBe('Counter phone')
    expect(state.steps.find((s) => s.id === 'phone')?.done).toBe(false)
    expect(state.steps.find((s) => s.id === 'phone')?.detail).toMatch(/scanned .* approve below/i)
  })

  it('counts the phone once it is approved, and stops offering approval', async () => {
    await scanned('active')
    const state = await getSetupState(businessId)

    expect(state.pendingPhones).toHaveLength(0)
    expect(state.steps.find((s) => s.id === 'phone')?.done).toBe(true)
    expect(state.firstDeviceId).not.toBeNull()
  })

  it('lets a declined phone be replaced by a fresh code', async () => {
    /*
     * The wrong handset, or a code a stranger walked past. Revoking clears the
     * token hash — the credential that phone holds stops verifying rather than
     * merely being ignored — and drops it out of `awaiting_approval`, so the
     * step goes back to offering a new code instead of waiting forever on one
     * nobody wants.
     */
    const deviceId = await scanned('awaiting_approval')
    expect((await getSetupState(businessId)).pendingPhones.map((p) => p.id)).toEqual([deviceId])

    await revokeDevice({ deviceId, actorId })

    const state = await getSetupState(businessId)
    expect(state.pendingPhones).toHaveLength(0)
    expect(state.steps.find((s) => s.id === 'phone')?.done).toBe(false)

    const revoked = await db.query.devices.findFirst({ where: eq(devices.id, deviceId) })
    expect(revoked?.status).toBe('revoked')
    expect(revoked?.tokenHash).toBeNull()
  })

  it('carries every phone waiting, not just the first', async () => {
    /*
     * A business runs more than one — a till phone and a back-office phone, or
     * one per SIM. Surfacing only the first meant the second could not be
     * approved from here at all, and scanning again just queued another behind
     * it.
     */
    await db.delete(devices).where(eq(devices.businessId, businessId))
    for (const name of ['Till phone', 'Back office']) {
      await db.insert(devices).values({
        businessId,
        name,
        status: 'awaiting_approval',
        provisionedAt: new Date(),
        tokenHash: `hash-${randomBytes(6).toString('hex')}`,
      })
    }

    const state = await getSetupState(businessId)
    expect(state.pendingPhones.map((p) => p.name).sort()).toEqual(['Back office', 'Till phone'])
  })

  it('does not offer another business’s phone for approval', async () => {
    // These ids are handed to a server action that approves whatever they
    // name, so the list must never carry somebody else's device.
    await scanned('awaiting_approval')

    expect((await getSetupState(randomUUID())).pendingPhones).toHaveLength(0)
  })
})
