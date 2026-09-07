import { randomBytes, randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db, pool } from '@/lib/db/client'
import {
  apps,
  businesses,
  incomingPayments,
  paymentIntents,
  receivingAccounts,
  users,
} from '@/lib/db/schema'
import { createApiKey } from '@/lib/services/app-admin'

/**
 * The tenant boundary as a *stranger with a key* actually meets it.
 *
 * `tenant-isolation` proves the `assertOwns…` primitives refuse the wrong
 * business. That is necessary and not sufficient: it says nothing about whether
 * a given route remembers to call one. A handler that drops
 * `requireIntent(id, app.appId)` and looks the row up directly passes every
 * assertion in that file and hands another merchant's payment to anyone with an
 * API key.
 *
 * So these go over HTTP, against the routes as they are mounted, with two real
 * businesses and two real keys. What is being checked is the wiring, not the
 * guard.
 *
 * ## Needs a dev server
 *
 * Same arrangement as `pairing-flow`: it skips rather than fails when nothing is
 * listening, because a red suite meaning "you did not start the server" teaches
 * people to ignore red suites.
 */

const BASE = process.env.JOMMA_URL ?? 'http://localhost:3000'

let serverUp = false

interface Tenant {
  businessId: string
  appId: string
  accountId: string
  msisdn: string
  key: string
}

let victim: Tenant
let stranger: Tenant
const createdUsers: string[] = []

async function reachable(): Promise<boolean> {
  try {
    const response = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(3000) })
    return response.ok
  } catch {
    return false
  }
}

async function makeTenant(name: string): Promise<Tenant> {
  const slug = `${name}-${randomBytes(4).toString('hex')}`

  const actorId = randomUUID()
  await db.insert(users).values({ id: actorId, name, email: `${actorId}@test.local` })
  createdUsers.push(actorId)

  const [business] = await db
    .insert(businesses)
    .values({ name, slug, status: 'active' })
    .returning({ id: businesses.id })
  if (!business) throw new Error('could not create the business')

  const [app] = await db
    .insert(apps)
    .values({ businessId: business.id, name: `${slug} app`, slug: `${slug}-app` })
    .returning({ id: apps.id })
  if (!app) throw new Error('could not create the app')

  // Unique per run: the msisdn index is global, deliberately — one number
  // cannot be watched by two businesses at once.
  const msisdn = `8809${randomBytes(5).toString('hex').replace(/\D/g, '').padEnd(9, '1').slice(0, 9)}`
  const [account] = await db
    .insert(receivingAccounts)
    .values({
      businessId: business.id,
      provider: 'bkash',
      msisdn,
      label: `${slug} phone`,
      /*
       * Active *and* recently heard from. `routable` in `accounts.ts` needs
       * both — an account whose phone has gone quiet is not one checkout will
       * send a buyer to — and without the heartbeat every intent here comes
       * back 503 `no_healthy_account`, which reads like a broken fixture rather
       * than the deliberate rule it is.
       */
      status: 'active',
      lastHeartbeatAt: new Date(),
    })
    .returning({ id: receivingAccounts.id })
  if (!account) throw new Error('could not create the account')

  const { plaintext } = await createApiKey({
    appId: app.id,
    name: 'audit key',
    environment: 'live',
    actorId,
  })

  return { businessId: business.id, appId: app.id, accountId: account.id, msisdn, key: plaintext }
}

const as = (tenant: Tenant, method: string, path: string, body?: unknown) =>
  fetch(`${BASE}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${tenant.key}`,
      'content-type': 'application/json',
      // Required on intent creation, harmless elsewhere.
      'idempotency-key': randomUUID(),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

beforeAll(async () => {
  serverUp = await reachable()
  if (!serverUp) return

  victim = await makeTenant('victim')
  stranger = await makeTenant('stranger')
})

afterAll(async () => {
  if (serverUp) {
    for (const tenant of [victim, stranger]) {
      if (!tenant) continue
      // Payments and intents first: both restrict on delete, deliberately, so a
      // business cannot be removed out from under money observed arriving.
      await db.delete(paymentIntents).where(eq(paymentIntents.receivingAccountId, tenant.accountId))
      await db
        .delete(incomingPayments)
        .where(eq(incomingPayments.receivingAccountId, tenant.accountId))
      await db.delete(businesses).where(eq(businesses.id, tenant.businessId))
    }
    for (const id of createdUsers) await db.delete(users).where(eq(users.id, id))
  }
  await pool.end()
})

describe('one key against another business, over HTTP', () => {
  const skip = () => {
    if (!serverUp) console.warn(`  skipped: no server at ${BASE} — run \`pnpm dev\``)
    return !serverUp
  }

  let intentId: string

  it('creates an intent on the victim, as the victim', async () => {
    if (skip()) return

    const response = await as(victim, 'POST', '/api/v1/intents', {
      amount: 50_000,
      client_reference: `XT-${randomBytes(4).toString('hex')}`,
      ttl_seconds: 300,
    })
    const body = await response.json()

    expect(response.status, JSON.stringify(body)).toBe(201)
    expect(body.id).toBeTruthy()
    intentId = body.id
  })

  it('refuses a stranger reading it', async () => {
    if (skip()) return

    const response = await as(stranger, 'GET', `/api/v1/intents/${intentId}`)
    expect([403, 404]).toContain(response.status)
  })

  it('does not confirm the intent exists, either', async () => {
    if (skip()) return

    /*
     * 404 and not 403. A 403 on a real id and a 404 on an invented one is an
     * oracle: it lets anyone with a key walk the id space and learn which
     * payments exist on the instance, which is most of what enumeration wants.
     */
    const real = await as(stranger, 'GET', `/api/v1/intents/${intentId}`)
    const invented = await as(stranger, 'GET', '/api/v1/intents/int_01M1P9BWNZFT3VDY1K440YAPWA')

    expect(real.status).toBe(invented.status)
  })

  it('refuses a stranger cancelling it', async () => {
    if (skip()) return

    const response = await as(stranger, 'POST', `/api/v1/intents/${intentId}/cancel`)
    expect([403, 404]).toContain(response.status)

    // And it is genuinely untouched, not merely reported as refused.
    const mine = await (await as(victim, 'GET', `/api/v1/intents/${intentId}`)).json()
    expect(mine.status).toBe('open')
  })

  it('refuses a stranger extending it', async () => {
    if (skip()) return

    const response = await as(stranger, 'POST', `/api/v1/intents/${intentId}/extend`, {
      ttl_seconds: 3600,
    })
    expect([403, 404]).toContain(response.status)
  })

  it('refuses a stranger submitting against it', async () => {
    if (skip()) return

    // The one that would actually move money: settling another shop's order
    // from a payment made to yours.
    const response = await as(stranger, 'POST', '/api/v1/submissions', {
      intent_id: intentId,
      trx_id: 'CHA1B2C3D4',
    })
    expect([403, 404]).toContain(response.status)
  })

  it('does not list the victim’s numbers to a stranger', async () => {
    if (skip()) return

    /*
     * The check that would have failed before receiving accounts belonged to a
     * business: `/v1/accounts` returned every number on the instance, so one
     * merchant could enumerate another's phones — and checkout could route a
     * buyer at one of them.
     */
    const body = await (await as(stranger, 'GET', '/api/v1/accounts')).json()
    const numbers = (body.accounts ?? []).map((account: { msisdn: string }) => account.msisdn)

    expect(numbers).toContain(stranger.msisdn)
    expect(numbers).not.toContain(victim.msisdn)
  })

  it('still lets the victim do all of it', async () => {
    if (skip()) return

    /*
     * The other half. Every assertion above would pass just as well against a
     * server that refused everybody, and a boundary that blocks the owner is a
     * different outage rather than a fixed bug.
     */
    expect((await as(victim, 'GET', `/api/v1/intents/${intentId}`)).status).toBe(200)
    expect(
      (await as(victim, 'POST', `/api/v1/intents/${intentId}/extend`, { ttl_seconds: 600 })).status,
    ).toBe(200)
    expect((await as(victim, 'POST', `/api/v1/intents/${intentId}/cancel`)).status).toBe(200)
  })
})
