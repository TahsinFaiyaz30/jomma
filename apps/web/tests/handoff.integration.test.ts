import { randomBytes, randomInt, randomUUID } from 'node:crypto'
import { fromPublicId, toPublicId } from '@jomma/shared'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db, pool } from '@/lib/db/client'
import { apps, businesses, paymentIntents, receivingAccounts, users } from '@/lib/db/schema'

/**
 * Carrying the instructions to a phone, and taking them back.
 *
 * The pay page's QR encodes the page's own URL, so a phone that scans it opens
 * a browser that has never seen the buyer choose a wallet — and asks them
 * again, on the second device, which is the thing they scanned the code to
 * avoid. The token in that URL is what turns the scan into a continuation.
 *
 * The half that matters more is revocation. The buyer can go back on the screen
 * they scanned from and pick a different wallet, which re-routes the intent to a
 * different receiving account. The phone is still polling, and without the
 * token it would quietly adopt the new number mid-payment. So going back clears
 * the token, and everything that reads it has to notice: the QR route, the
 * status poll, and the page itself.
 *
 * ## Needs a dev server
 */

const BASE = process.env.JOMMA_URL ?? 'http://localhost:3000'

/* One client address per file — the pay endpoints are rate limited by IP. */
const CLIENT_IP = '10.9.0.214'

let serverUp = false
let businessId = ''
let accountId = ''
let appId = ''
let actorId = ''

async function reachable() {
  try {
    return (await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(3000) })).ok
  } catch {
    return false
  }
}

/** An open intent whose buyer has already answered both questions. */
async function intent() {
  const [row] = await db
    .insert(paymentIntents)
    .values({
      appId,
      receivingAccountId: accountId,
      amountCents: 50_000,
      clientReference: `H-${randomBytes(4).toString('hex')}`,
      payerMsisdn: '8801712345878',
      payerMsisdnSource: 'buyer',
      ttlSeconds: 900,
      expiresAt: new Date(Date.now() + 900_000),
    })
    .returning({ id: paymentIntents.id })
  return toPublicId('intent', row!.id)
}

const headers = { 'x-forwarded-for': CLIENT_IP }

const mint = (id: string) =>
  fetch(`${BASE}/api/pay/${id}/handoff`, { method: 'POST', headers }).then((r) => r.json())

const revoke = (id: string) => fetch(`${BASE}/api/pay/${id}/handoff`, { method: 'DELETE', headers })

const qr = (id: string, token: string) =>
  fetch(`${BASE}/api/pay/${id}/qr?h=${encodeURIComponent(token)}`, { headers })

const status = (id: string, token: string) =>
  fetch(`${BASE}/api/pay/${id}/status?h=${encodeURIComponent(token)}`, { headers }).then((r) =>
    r.json(),
  )

beforeAll(async () => {
  serverUp = await reachable()
  if (!serverUp) return

  actorId = randomUUID()
  await db.insert(users).values({ id: actorId, name: 'Handoff', email: `${actorId}@test.local` })
  const slug = `handoff-${randomBytes(4).toString('hex')}`
  const [b] = await db
    .insert(businesses)
    .values({ name: 'Handoff', slug, status: 'active' })
    .returning({ id: businesses.id })
  businessId = b!.id

  const [a] = await db
    .insert(apps)
    .values({ businessId, name: 'Shop', slug: `${slug}-app` })
    .returning({ id: apps.id })
  appId = a!.id

  const [acc] = await db
    .insert(receivingAccounts)
    .values({
      businessId,
      provider: 'bkash',
      // Built rather than filtered out of hex: an operator prefix has to be
      // 013–019, and a run that happened to start 0, 1 or 2 was rejected.
      msisdn: `88018${String(randomInt(0, 100_000_000)).padStart(8, '0')}`,
      label: 'test',
      status: 'active',
    })
    .returning({ id: receivingAccounts.id })
  accountId = acc!.id
})

afterAll(async () => {
  if (serverUp) {
    await db.delete(paymentIntents).where(eq(paymentIntents.appId, appId))
    await db.delete(apps).where(eq(apps.businessId, businessId))
    await db.delete(receivingAccounts).where(eq(receivingAccounts.businessId, businessId))
    await db.delete(businesses).where(eq(businesses.id, businessId))
    await db.delete(users).where(eq(users.id, actorId))
  }
  await pool.end()
})

const skip = () => {
  if (!serverUp) console.warn(`  skipped: no server at ${BASE}`)
  return !serverUp
}

describe('handing the instructions to a phone', () => {
  it('mints one token and keeps handing out the same one', async () => {
    if (skip()) return
    const id = await intent()

    const first = await mint(id)
    const second = await mint(id)

    expect(typeof first.token).toBe('string')
    expect(first.token.length).toBeGreaterThan(16)
    /*
     * The property the whole thing rests on. A second call — a remount, a
     * second tab, React invoking an effect twice — must not invalidate the QR
     * the first one is already displaying.
     */
    expect(second.token).toBe(first.token)
  })

  it('puts the token in the scannable link', async () => {
    if (skip()) return
    const id = await intent()
    const { token } = await mint(id)

    const response = await qr(id, token)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('image/png')
  })

  it('reports a live token as live on the poll', async () => {
    if (skip()) return
    const id = await intent()
    const { token } = await mint(id)

    expect((await status(id, token)).handoff_valid).toBe(true)
  })

  it('says nothing about a handoff when none was presented', async () => {
    if (skip()) return
    const id = await intent()
    await mint(id)

    const body = await fetch(`${BASE}/api/pay/${id}/status`, { headers }).then((r) => r.json())
    // Null, not false. The ordinary page has no session to be told about, and
    // reading a bare `false` there would cancel a screen that is working fine.
    expect(body.handoff_valid).toBeNull()
  })
})

describe('taking them back', () => {
  it('kills the token, the image and the poll together', async () => {
    if (skip()) return
    const id = await intent()
    const { token } = await mint(id)

    expect((await revoke(id)).status).toBe(200)

    // The phone finds out here: this is the poll it is already running.
    expect((await status(id, token)).handoff_valid).toBe(false)
    // And a camera pointed at a printed or photographed code gets nothing.
    expect((await qr(id, token)).status).toBe(409)
  })

  it('does not resurrect the old token on the next mint', async () => {
    if (skip()) return
    const id = await intent()
    const { token: before } = await mint(id)
    await revoke(id)

    const { token: after } = await mint(id)

    expect(after).not.toBe(before)
    // A photograph of the first code stays dead after the second is issued.
    expect((await status(id, before)).handoff_valid).toBe(false)
    expect((await status(id, after)).handoff_valid).toBe(true)
  })

  it('succeeds when there was nothing to revoke', async () => {
    if (skip()) return
    // Called on the way out of a screen, with a different one about to render.
    // Failing would strand the buyer on instructions they asked to leave.
    expect((await revoke(await intent())).status).toBe(200)
  })
})

describe('a token nobody minted', () => {
  it('is not accepted because it is well formed', async () => {
    if (skip()) return
    const id = await intent()
    await mint(id)

    expect((await status(id, randomBytes(18).toString('base64url'))).handoff_valid).toBe(false)
    expect((await qr(id, 'not-the-token')).status).toBe(409)
  })

  it('does not make a plain pay link unscannable', async () => {
    if (skip()) return
    // No token at all is a merchant printing the URL by hand, or a link in an
    // email. It still resolves; it just starts at the top of the queue.
    const id = await intent()
    const response = await fetch(`${BASE}/api/pay/${id}/qr`, { headers })

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('image/png')
  })
})

describe('a suspended merchant', () => {
  it('cannot hand a payment to a second screen', async () => {
    if (skip()) return
    /*
     * The pay page withholds the number when a business is suspended, but this
     * endpoint answers anyone holding the link directly — and a QR is a second
     * route to the same instruction, one that outlives the suspension on a
     * counter or in a camera roll.
     */
    const id = await intent()
    await db.update(businesses).set({ status: 'suspended' }).where(eq(businesses.id, businessId))

    try {
      const response = await fetch(`${BASE}/api/pay/${id}/handoff`, { method: 'POST', headers })
      expect(response.status).toBe(403)

      const row = await db.query.paymentIntents.findFirst({
        where: eq(paymentIntents.id, fromPublicId('intent', id) as string),
      })
      expect(row?.handoffToken, 'nothing was minted').toBeNull()
    } finally {
      await db.update(businesses).set({ status: 'active' }).where(eq(businesses.id, businessId))
    }
  })
})
