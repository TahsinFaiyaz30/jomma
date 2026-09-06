import { randomBytes } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db, pool } from '@/lib/db/client'
import {
  apiKeys,
  apps,
  businesses,
  devices,
  incomingPayments,
  memberships,
  notifierEvents,
  paymentIntents,
  receivingAccounts,
  users,
  webhookEndpoints,
} from '@/lib/db/schema'
import {
  assertOwnsApiKey,
  assertOwnsApp,
  assertOwnsDevice,
  assertOwnsEndpoint,
  assertOwnsIncomingPayment,
  assertOwnsIntent,
  assertOwnsNotifierEvent,
  assertOwnsReceivingAccount,
  setMemberRole,
} from '@/lib/services/businesses'

/**
 * The tenant boundary, against a real database.
 *
 * These exist because the boundary is only as good as its weakest caller, and
 * two real holes were found by hand rather than by a test: the command palette
 * searched every business on the instance, and four setup-wizard actions took a
 * row id and never checked whose it was — one of which minted a live API key
 * for whatever app id it was handed.
 *
 * So this pins the primitive those callers depend on. Every assertion is proved
 * twice: it lets the owner through, and it refuses a stranger. Only proving the
 * refusal would pass just as well if the function threw unconditionally.
 */

let victim: { business: string; app: string; account: string }
let attacker: { business: string; app: string; account: string }
const created: { table: 'business'; id: string }[] = []

async function makeBusiness(name: string) {
  const slug = `${name}-${randomBytes(4).toString('hex')}`
  const [business] = await db
    .insert(businesses)
    .values({ name, slug, status: 'active' })
    .returning({ id: businesses.id })
  if (!business) throw new Error('could not create the business')
  created.push({ table: 'business', id: business.id })

  const [app] = await db
    .insert(apps)
    .values({ businessId: business.id, name: `${slug} app`, slug: `${slug}-app` })
    .returning({ id: apps.id })

  const [account] = await db
    .insert(receivingAccounts)
    .values({
      businessId: business.id,
      provider: 'bkash',
      // Unique per run: the msisdn index is global, deliberately.
      msisdn: `8809${randomBytes(5).toString('hex').replace(/\D/g, '').padEnd(9, '1').slice(0, 9)}`,
      label: `${slug} phone`,
    })
    .returning({ id: receivingAccounts.id })

  if (!app || !account) throw new Error('could not create the fixtures')
  return { business: business.id, app: app.id, account: account.id }
}

beforeAll(async () => {
  victim = await makeBusiness('victim')
  attacker = await makeBusiness('attacker')
})

afterAll(async () => {
  /*
   * Payments first, then the businesses.
   *
   * `incoming_payments.receiving_account_id` is ON DELETE RESTRICT while the
   * account itself cascades from its business — deliberately, so a business
   * cannot be deleted out from under money that was observed arriving.
   * `payment_intents` restricts the same way.
   *
   * Worth knowing rather than working around: deleting a merchant who has ever
   * taken a payment fails, and should. Anyone offboarding one has to decide
   * what happens to the records first.
   */
  for (const { account } of [victim, attacker]) {
    await db.delete(paymentIntents).where(eq(paymentIntents.receivingAccountId, account))
    await db.delete(incomingPayments).where(eq(incomingPayments.receivingAccountId, account))
  }
  for (const row of created) await db.delete(businesses).where(eq(businesses.id, row.id))
  await pool.end()
})

/** Proves both directions, so an unconditionally-throwing guard cannot pass. */
const bothWays = (
  label: string,
  run: (businessId: string, rowId: string) => Promise<void>,
  ownerBusiness: () => string,
  strangerBusiness: () => string,
  rowId: () => string,
) => {
  describe(label, () => {
    it('lets the owner through', async () => {
      await expect(run(ownerBusiness(), rowId())).resolves.toBeUndefined()
    })

    it('refuses another business', async () => {
      await expect(run(strangerBusiness(), rowId())).rejects.toThrow()
    })

    it('refuses an id that does not exist', async () => {
      await expect(run(ownerBusiness(), '00000000-0000-7000-8000-000000000000')).rejects.toThrow()
    })
  })
}

bothWays(
  'assertOwnsApp',
  assertOwnsApp,
  () => victim.business,
  () => attacker.business,
  () => victim.app,
)

bothWays(
  'assertOwnsReceivingAccount',
  assertOwnsReceivingAccount,
  () => victim.business,
  () => attacker.business,
  () => victim.account,
)

describe('assertOwnsApiKey', () => {
  let keyId: string
  beforeAll(async () => {
    const [row] = await db
      .insert(apiKeys)
      .values({
        appId: victim.app,
        name: 'test',
        prefix: `jm_live_${randomBytes(4).toString('hex')}`,
        lastFour: 'abcd',
        keyHash: 'x',
      })
      .returning({ id: apiKeys.id })
    keyId = row?.id ?? ''
  })

  it('lets the owner through', async () => {
    await expect(assertOwnsApiKey(victim.business, keyId)).resolves.toBeUndefined()
  })

  it('refuses another business, which would otherwise be a key takeover', async () => {
    await expect(assertOwnsApiKey(attacker.business, keyId)).rejects.toThrow()
  })
})

describe('assertOwnsEndpoint', () => {
  let endpointId: string
  beforeAll(async () => {
    const [row] = await db
      .insert(webhookEndpoints)
      .values({
        appId: victim.app,
        url: `https://example.test/${randomBytes(4).toString('hex')}`,
        secret: 'x',
        enabledEvents: ['payment.succeeded'],
      })
      .returning({ id: webhookEndpoints.id })
    endpointId = row?.id ?? ''
  })

  it('lets the owner through', async () => {
    await expect(assertOwnsEndpoint(victim.business, endpointId)).resolves.toBeUndefined()
  })

  it('refuses another business, which would otherwise redirect their events', async () => {
    await expect(assertOwnsEndpoint(attacker.business, endpointId)).rejects.toThrow()
  })
})

describe('assertOwnsDevice', () => {
  let deviceId: string
  beforeAll(async () => {
    const [row] = await db
      .insert(devices)
      .values({ receivingAccountId: victim.account, name: 'test phone' })
      .returning({ id: devices.id })
    deviceId = row?.id ?? ''
  })

  it('lets the owner through', async () => {
    await expect(assertOwnsDevice(victim.business, deviceId)).resolves.toBeUndefined()
  })

  it('refuses another business', async () => {
    await expect(assertOwnsDevice(attacker.business, deviceId)).rejects.toThrow()
  })
})

describe('assertOwnsNotifierEvent', () => {
  let eventId: string
  beforeAll(async () => {
    const [row] = await db
      .insert(notifierEvents)
      .values({ receivingAccountId: victim.account, kind: 'error', detail: 'test' })
      .returning({ id: notifierEvents.id })
    eventId = row?.id ?? ''
  })

  it('lets the owner through', async () => {
    await expect(assertOwnsNotifierEvent(victim.business, eventId)).resolves.toBeUndefined()
  })

  it('refuses another business', async () => {
    await expect(assertOwnsNotifierEvent(attacker.business, eventId)).rejects.toThrow()
  })

  it('refuses an instance-wide event, which belongs to no business', async () => {
    const [orphan] = await db
      .insert(notifierEvents)
      .values({ kind: 'error', detail: 'no account' })
      .returning({ id: notifierEvents.id })
    await expect(assertOwnsNotifierEvent(victim.business, orphan?.id ?? '')).rejects.toThrow()
  })
})

describe('assertOwnsIntent and assertOwnsIncomingPayment', () => {
  let intentId: string
  let paymentId: string

  beforeAll(async () => {
    const [intent] = await db
      .insert(paymentIntents)
      .values({
        appId: victim.app,
        receivingAccountId: victim.account,
        amountCents: 50_000,
        clientReference: `T-${randomBytes(4).toString('hex')}`,
        ttlSeconds: 900,
        expiresAt: new Date(Date.now() + 900_000),
      })
      .returning({ id: paymentIntents.id })
    intentId = intent?.id ?? ''

    const [payment] = await db
      .insert(incomingPayments)
      .values({
        receivingAccountId: victim.account,
        provider: 'bkash',
        rawMessage: 'test',
        source: 'sms',
        adapter: 'android_sms',
        amountCents: 50_000,
        receivedAt: new Date(),
      })
      .returning({ id: incomingPayments.id })
    paymentId = payment?.id ?? ''
  })

  it('lets the owner read its own intent', async () => {
    await expect(assertOwnsIntent(victim.business, intentId)).resolves.toBeUndefined()
  })

  it('refuses another business reading it', async () => {
    await expect(assertOwnsIntent(attacker.business, intentId)).rejects.toThrow()
  })

  it('lets the owner act on its own payment', async () => {
    await expect(assertOwnsIncomingPayment(victim.business, paymentId)).resolves.toBeUndefined()
  })

  it('refuses another business, which would otherwise pay one order from another shop', async () => {
    await expect(assertOwnsIncomingPayment(attacker.business, paymentId)).rejects.toThrow()
  })
})

describe('setMemberRole', () => {
  let ownerId: string

  beforeAll(async () => {
    ownerId = randomBytes(8).toString('hex')
    await db.insert(users).values({ id: ownerId, name: 'Owner', email: `${ownerId}@test.local` })
    await db
      .insert(memberships)
      .values({ userId: ownerId, businessId: victim.business, role: 'owner' })
  })

  it('refuses to demote the last owner', async () => {
    // A business whose only owner has demoted themselves cannot add members,
    // cannot change roles, and cannot be recovered from inside the product.
    await expect(
      setMemberRole({ businessId: victim.business, userId: ownerId, role: 'viewer' }),
    ).rejects.toThrow(/at least one owner/i)
  })

  it('allows the demotion once a second owner exists', async () => {
    const second = randomBytes(8).toString('hex')
    await db.insert(users).values({ id: second, name: 'Second', email: `${second}@test.local` })
    await db
      .insert(memberships)
      .values({ userId: second, businessId: victim.business, role: 'owner' })

    await expect(
      setMemberRole({ businessId: victim.business, userId: ownerId, role: 'viewer' }),
    ).resolves.toBeUndefined()
  })
})
