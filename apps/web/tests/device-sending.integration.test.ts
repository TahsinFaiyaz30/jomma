import { randomBytes, randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { expect, it } from 'vitest'
import { db, pool } from '@/lib/db/client'
import { businesses, devices, users } from '@/lib/db/schema'
import { createReceivingAccount } from '@/lib/services/account-admin'
import { listDevices, requestSending } from '@/lib/services/devices'

/**
 * Reaching the phone's reporting switch from the dashboard.
 *
 * The switch belongs on the handset — somebody at the counter decides whether
 * their phone reports — and that is no use when the handset is not in the room.
 * A merchant whose phone was paused and then left in a drawer had no way back:
 * the dashboard could not even see that it was paused, so the row looked
 * healthy while nothing arrived.
 *
 * Queued rather than written straight to the column, and this pins that. The
 * phone is what actually captures, so it has to be the thing that agrees;
 * flipping the flag here would have the dashboard claim resumed while the
 * handset went on refusing, which is the exact disagreement the flag exists to
 * surface.
 */

it('the dashboard can reach the switch that lives on the phone', async () => {
  const actorId = randomUUID()
  await db.insert(users).values({ id: actorId, name: 'S', email: `${actorId}@test.local` })
  const [b] = await db
    .insert(businesses)
    .values({ name: 'Send', slug: `send-${randomBytes(4).toString('hex')}`, status: 'active' })
    .returning({ id: businesses.id })

  const account = await createReceivingAccount({
    businessId: b!.id,
    provider: 'bkash',
    msisdn: `8801${randomBytes(4).toString('hex').replace(/\D/g, '').padEnd(9, '7').slice(0, 9)}`,
    label: 'test',
    actorId,
  })

  const [d] = await db
    .insert(devices)
    .values({
      businessId: b!.id,
      receivingAccountId: account.id,
      name: 'Counter phone',
      status: 'active',
      tokenHash: 'x',
      provisionedAt: new Date(),
      // What the phone last said: paused.
      sendingEnabled: false,
    })
    .returning({ id: devices.id })

  // The dashboard can see it, which it could not before.
  const rows = await listDevices(account.id)
  expect(rows[0]!.sendingEnabled).toBe(false)

  await requestSending({ deviceId: d!.id, enabled: true, actorId })

  const after = await db.query.devices.findFirst({ where: eq(devices.id, d!.id) })
  expect(after!.pendingCommands).toEqual([{ type: 'set_sending', enabled: true }])
  // Deliberately NOT flipped here: the phone is what must actually resume, and
  // it writes the column back on its next beat.
  expect(after!.sendingEnabled).toBe(false)

  await db.delete(devices).where(eq(devices.businessId, b!.id))
  await db.delete(businesses).where(eq(businesses.id, b!.id))
  await db.delete(users).where(eq(users.id, actorId))
  await pool.end()
})
