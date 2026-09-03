import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { generateDeviceToken } from '@/lib/auth/tokens'
import { db, pool } from '@/lib/db/client'
import { devices, receivingAccounts } from '@/lib/db/schema'
import { completeTokenRotation, requestTokenRotation } from '@/lib/services/devices'

/**
 * Device commands and token rotation, against a real database.
 *
 * The regression this pins down: draining `pending_commands` with
 * `UPDATE ... RETURNING` hands back the *new* row in Postgres, so the endpoint
 * returned the empty array it had just written and every command — flush_queue,
 * rotate_token, stop — was silently lost. Nothing failed; devices simply never
 * heard anything.
 *
 *   pnpm db:up && pnpm db:migrate && pnpm db:seed
 *   pnpm --filter @jomma/web test:integration
 */

const ADMIN = '00000000-0000-0000-0000-000000000000'
let deviceId: string
let currentPrefix: string

beforeAll(async () => {
  const account = await db.query.receivingAccounts.findFirst({
    where: eq(receivingAccounts.msisdn, '8801799887766'),
  })
  if (!account) throw new Error('run pnpm db:seed first')

  const issued = await generateDeviceToken()
  currentPrefix = issued.prefix

  const [created] = await db
    .insert(devices)
    .values({
      receivingAccountId: account.id,
      name: 'Rotation test phone',
      platform: 'android',
      status: 'active',
      tokenPrefix: issued.prefix,
      tokenHash: issued.hash,
      tokenIssuedAt: new Date(),
      provisionedAt: new Date(),
    })
    .returning()

  if (!created) throw new Error('failed to create the test device')
  deviceId = created.id
})

afterAll(async () => {
  if (deviceId) await db.delete(devices).where(eq(devices.id, deviceId))
  await pool.end()
})

describe('device command queue', () => {
  it('queues a rotation without touching the current token', async () => {
    const before = await db.query.devices.findFirst({ where: eq(devices.id, deviceId) })

    await requestTokenRotation({ deviceId, actorId: ADMIN })

    const after = await db.query.devices.findFirst({ where: eq(devices.id, deviceId) })

    expect(after?.pendingCommands).toEqual([{ type: 'rotate_token' }])
    // The whole point: a queued rotation must not lock the phone out. If the
    // token needs killing right now, that is revocation, not rotation.
    expect(after?.tokenHash).toBe(before?.tokenHash)
    expect(after?.tokenPrefix).toBe(before?.tokenPrefix)
  })

  it('refuses to queue a rotation for a revoked device', async () => {
    await db.update(devices).set({ status: 'revoked' }).where(eq(devices.id, deviceId))

    await expect(requestTokenRotation({ deviceId, actorId: ADMIN })).rejects.toThrow()

    await db.update(devices).set({ status: 'active' }).where(eq(devices.id, deviceId))
  })
})

describe('token rotation', () => {
  it('swaps the token and clears the command', async () => {
    await requestTokenRotation({ deviceId, actorId: ADMIN })

    const { deviceToken } = await completeTokenRotation({ deviceId, currentPrefix })
    expect(deviceToken.startsWith('jmd_')).toBe(true)

    const after = await db.query.devices.findFirst({ where: eq(devices.id, deviceId) })
    expect(after?.tokenPrefix).not.toBe(currentPrefix)
    expect(after?.pendingCommands).toEqual([])

    currentPrefix = after?.tokenPrefix ?? currentPrefix
  })

  it('refuses a replayed rotation, so one command cannot mint two tokens', async () => {
    // Whichever request lands first wins; the second finds the prefix changed.
    await expect(
      completeTokenRotation({ deviceId, currentPrefix: 'jmd_stale123' }),
    ).rejects.toThrow('rotation_conflict')
  })

  it('refuses to rotate a revoked device', async () => {
    await db.update(devices).set({ status: 'revoked' }).where(eq(devices.id, deviceId))

    await expect(completeTokenRotation({ deviceId, currentPrefix })).rejects.toThrow()

    await db.update(devices).set({ status: 'active' }).where(eq(devices.id, deviceId))
  })
})
