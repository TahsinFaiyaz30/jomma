import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db, pool } from '@/lib/db/client'
import { apps, paymentAudit, receivingAccounts, users } from '@/lib/db/schema'
import { createReceivingAccount } from '@/lib/services/account-admin'
import { createApp } from '@/lib/services/app-admin'

/**
 * Creating the two things a deployment cannot start without.
 *
 * Both used to exist only in the development seed. A production instance
 * bootstrapped with `--admin-only` therefore had an admin, an empty dashboard,
 * and no route to a first receiving account or app — the screens that manage
 * them could not create them. These tests exist so that dead end cannot come
 * back quietly.
 */

let actorId: string
const created: string[] = []
const createdApps: string[] = []

beforeAll(async () => {
  const [admin] = await db.select({ id: users.id }).from(users).limit(1)
  if (!admin) throw new Error('No admin in the database. Run `pnpm db:seed` first.')
  actorId = admin.id
})

afterAll(async () => {
  for (const id of created) await db.delete(receivingAccounts).where(eq(receivingAccounts.id, id))
  for (const id of createdApps) await db.delete(apps).where(eq(apps.id, id))
  await pool.end()
})

describe('createReceivingAccount', () => {
  const unique = () => `017${String(Date.now()).slice(-8)}`

  it('normalises every way of writing the number to the 880 form', async () => {
    // The parsers emit 880…, and the matcher compares the two directly, so a
    // local-format row would simply never match a real payment.
    const local = unique()
    const account = await createReceivingAccount({
      provider: 'bkash',
      msisdn: local,
      label: 'Written locally',
      actorId,
    })
    created.push(account.id)

    expect(account.msisdn).toBe(`880${local.slice(1)}`)
  })

  it('starts disabled, so checkout cannot route to it before a phone is watching', async () => {
    const account = await createReceivingAccount({
      provider: 'bkash',
      msisdn: unique(),
      label: 'Fresh',
      actorId,
    })
    created.push(account.id)

    const [row] = await db
      .select()
      .from(receivingAccounts)
      .where(eq(receivingAccounts.id, account.id))

    expect(row?.status).toBe('disabled')
    expect(row?.statusReason).toMatch(/provision/i)
  })

  it('records who added it', async () => {
    const account = await createReceivingAccount({
      provider: 'bkash',
      msisdn: unique(),
      label: 'Audited',
      actorId,
    })
    created.push(account.id)

    const entries = await db
      .select()
      .from(paymentAudit)
      .where(eq(paymentAudit.action, 'account.created'))

    expect(entries.some((e) => e.actorId === actorId)).toBe(true)
  })

  it('refuses a number that is not a Bangladeshi mobile', async () => {
    for (const bad of ['12345', '0171234567', '02712345678', 'not a number', '']) {
      await expect(
        createReceivingAccount({ provider: 'bkash', msisdn: bad, label: 'x', actorId }),
      ).rejects.toThrow()
    }
  })

  it('refuses a duplicate, however it is written', async () => {
    const local = unique()
    const first = await createReceivingAccount({
      provider: 'bkash',
      msisdn: local,
      label: 'First',
      actorId,
    })
    created.push(first.id)

    // Same number, written in the other format. Without normalising before the
    // check this would slip past and hit a raw unique-constraint error.
    await expect(
      createReceivingAccount({
        provider: 'bkash',
        msisdn: `880${local.slice(1)}`,
        label: 'Second',
        actorId,
      }),
    ).rejects.toThrow(/already/i)
  })
})

describe('createApp', () => {
  it('derives a slug and records the creation', async () => {
    const app = await createApp({ name: `Test Shop ${Date.now()}`, actorId })
    createdApps.push(app.id)

    expect(app.slug).toMatch(/^test-shop-\d+$/)
  })

  it('drops apostrophes rather than turning them into separators', async () => {
    const app = await createApp({ name: `Tahsin's Store ${Date.now()}`, actorId })
    createdApps.push(app.id)

    expect(app.slug).toMatch(/^tahsins-store-/)
    expect(app.slug).not.toContain('-s-')
  })

  it('refuses an empty name, and one with nothing sluggable in it', async () => {
    await expect(createApp({ name: '   ', actorId })).rejects.toThrow()
    await expect(createApp({ name: '!!! ???', actorId })).rejects.toThrow(/slug/i)
  })

  it('refuses a name that collides on slug', async () => {
    const name = `Collide ${Date.now()}`
    const app = await createApp({ name, actorId })
    createdApps.push(app.id)

    await expect(createApp({ name, actorId })).rejects.toThrow(/already/i)
  })
})
