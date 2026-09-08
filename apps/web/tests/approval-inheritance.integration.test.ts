import { randomBytes, randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db, pool } from '@/lib/db/client'
import { businesses, devices, notifierEvents, receivingAccounts, users } from '@/lib/db/schema'
import { approveDevice, createPhoneProvisioning } from '@/lib/services/devices'
import { getSetupState } from '@/lib/services/onboarding'
import { addAccountFromSim } from '@/lib/services/sim-accounts'

/**
 * Approving a phone is about the handset, not about each number on it.
 *
 * Choosing a SIM mints a *second* device row — one credential per number, so
 * revoking one leaves the others reporting — and that row landed
 * `awaiting_approval` like any other. So the sequence somebody actually
 * performs, in order, was:
 *
 *   1. pair the phone, approve it — "Approved"
 *   2. choose the bKash SIM for it
 *   3. the phone says it is waiting for approval again
 *   4. approve the same handset a second time, from the devices screen
 *
 * Nobody had changed their mind about the phone between 1 and 3. The operator
 * was being asked to vouch twice for the handset already in their hand, and the
 * second prompt appeared *because* they had done what the wizard asked.
 *
 * Inheritance is deliberately narrow, and these prove both halves of it: a code
 * the server bound to a known handset carries approval, and a QR on a dashboard
 * — which is a bearer credential anyone in the room can photograph — does not,
 * however many times it is scanned.
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
const CLIENT_IP = '10.9.0.62'

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

/** Mint a dashboard QR and redeem it, exactly as the app's scanner does. */
async function scanQr(installId: string, name = 'Counter phone') {
  const qr = await createPhoneProvisioning({ businessId, actorId })
  const response = await fetch(`${BASE}/device/v1/pair`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': CLIENT_IP },
    body: JSON.stringify({
      code: qr.payload.pair_url.split('/pair/')[1],
      device_name: name,
      install_id: installId,
    }),
  })
  return response.json() as Promise<{ device_id: string; awaiting_approval: boolean }>
}

/** Redeem an `add_account` code, as the heartbeat does when it drains one. */
async function redeem(pairUrl: string, installId: string) {
  const response = await fetch(`${BASE}/device/v1/pair`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': CLIENT_IP },
    body: JSON.stringify({
      code: pairUrl.split('/pair/')[1],
      device_name: 'Counter phone',
      install_id: installId,
    }),
  })
  return response.json() as Promise<{ device_id: string; awaiting_approval: boolean }>
}

/** Puts a SIM in a phone's last heartbeat, so a number can be chosen from it. */
async function reportSim(deviceId: string, msisdn: string) {
  await db
    .update(devices)
    .set({
      sims: [
        {
          subscription_id: 1,
          slot_index: 0,
          carrier_name: 'Grameenphone',
          display_name: 'GP',
          msisdn,
          number_source: 'sim',
          network_generation: 'lte',
        },
      ],
      simsReportedAt: new Date(),
    })
    .where(eq(devices.id, deviceId))
}

const statusOf = async (id: string) =>
  (await db.query.devices.findFirst({ where: eq(devices.id, id) }))?.status

beforeAll(async () => {
  serverUp = await reachable()
  if (!serverUp) return

  actorId = randomUUID()
  await db.insert(users).values({ id: actorId, name: 'Inherit', email: `${actorId}@test.local` })
  const [b] = await db
    .insert(businesses)
    .values({
      name: 'Inherit',
      slug: `inherit-${randomBytes(4).toString('hex')}`,
      status: 'active',
    })
    .returning({ id: businesses.id })
  businessId = b?.id ?? ''
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

describe('approval follows the handset', () => {
  const skip = () => {
    if (!serverUp) console.warn(`  skipped: no server at ${BASE}`)
    return !serverUp
  }

  it('does not ask again when an approved phone picks up a number', async () => {
    if (skip()) return
    const install = randomUUID()
    const msisdn = `88017${randomBytes(3).toString('hex').replace(/\D/g, '').padEnd(6, '4').slice(0, 6)}00`

    // 1. Pair and approve, once.
    const paired = await scanQr(install)
    expect(paired.awaiting_approval).toBe(true)
    await approveDevice({ deviceId: paired.device_id, actorId })

    // 2. Choose the SIM it is paid on, which queues a code for that handset.
    await reportSim(paired.device_id, msisdn)
    const added = await addAccountFromSim({
      businessId,
      deviceId: paired.device_id,
      subscriptionId: 1,
      provider: 'bkash',
      actorId,
    })
    expect(added.msisdn).toBe(msisdn)

    // 3. The phone drains the command and redeems it on its next beat.
    const [queued] = await db
      .select({ id: devices.id, pending: devices.pendingCommands })
      .from(devices)
      .where(eq(devices.id, paired.device_id))
    const command = (queued?.pending ?? []).find((c) => c.type === 'add_account')
    expect(command, 'the SIM choice should queue a pairing code').toBeDefined()

    const second = await redeem((command as { pair_url: string }).pair_url, install)

    // The whole point. Same handset, already approved: no second prompt.
    expect(second.awaiting_approval).toBe(false)
    expect(await statusOf(second.device_id)).toBe('active')

    /*
     * And nothing asking anybody to look at it.
     *
     * The accounts screen raises its attention badge from this event, so
     * firing one for a decision that has already been made teaches people to
     * ignore the badge. Scoped to the inherited row: the first pairing raised
     * one legitimately, and it should still be there.
     */
    const alerts = await db
      .select({ id: notifierEvents.id })
      .from(notifierEvents)
      .where(eq(notifierEvents.deviceId, second.device_id))
    expect(alerts).toHaveLength(0)

    const forTheFirst = await db
      .select({ id: notifierEvents.id })
      .from(notifierEvents)
      .where(eq(notifierEvents.deviceId, paired.device_id))
    expect(forTheFirst.length, 'the genuine approval still raised one').toBeGreaterThan(0)

    /*
     * And it is still one phone.
     *
     * There are now two device rows for it — the business pairing it scanned
     * with, and the credential for the bKash number — because revoking one
     * number must not kill the others. Both are the same piece of glass, and
     * counting rows had the wizard announce "2 connected" the moment somebody
     * chose a SIM, then three when they added a second wallet.
     */
    const state = await getSetupState(businessId)
    expect(state.connectedPhones).toHaveLength(1)
    expect(state.connectedPhones[0]?.name).toBe('Counter phone')
    // And the id stays put, so the SIM picker keeps addressing the same phone.
    expect(state.firstDeviceId).toBe(paired.device_id)
  })

  it('still requires approval for a QR, which is a bearer credential', async () => {
    if (skip()) return
    /*
     * The half that must not move. A dashboard QR is shown to a room and gets
     * screenshotted and forwarded; the whole reason approval exists is that
     * holding the code proves nothing about who is holding it.
     *
     * Scanned here by the *same* handset that is already approved above, which
     * is the case most likely to be waved through by a careless rule.
     */
    const install = randomUUID()
    await approveDevice({ deviceId: (await scanQr(install)).device_id, actorId })

    const again = await scanQr(install)
    expect(again.awaiting_approval).toBe(true)
    expect(await statusOf(again.device_id)).toBe('awaiting_approval')
  })

  it('does not trust a handset that was never approved here', async () => {
    if (skip()) return
    // A code bound to one phone, redeemed while claiming to be another. The
    // stranger's id has no approved device on this business, so it waits.
    const stranger = randomUUID()
    const paired = await scanQr(stranger, 'Somebody else')
    expect(paired.awaiting_approval).toBe(true)
    expect(await statusOf(paired.device_id)).toBe('awaiting_approval')
  })
})
