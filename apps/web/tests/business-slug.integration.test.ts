import { randomBytes } from 'node:crypto'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db, pool } from '@/lib/db/client'
import { businesses, memberships, users } from '@/lib/db/schema'
import { createBusiness } from '@/lib/services/businesses'

/**
 * Registering a merchant whose name collides with an existing one.
 *
 * `slug` is unique, and in service mode it appears in paths and in invitation
 * copy, so two merchants called "Rahim Store" is not hypothetical — it is the
 * ordinary case in a market with a few hundred common shop names.
 *
 * The failure this pins is not the ordinary collision, which always worked. It
 * is that the suffix used to be derived by *counting* the rows already matching
 * and appending `count + 1`, which assumes the taken suffixes are exactly
 * `2..count`. They are not: somebody registers "Rahim Store 3", that takes the
 * slug `rahim-store-3`, and the next plain "Rahim Store" counts two rows and
 * asks for the slug that is already sitting there. The insert then violates the
 * unique index and the whole transaction fails.
 *
 * Deterministic, so retrying gives the same answer — that name is simply
 * unregisterable from then on, with "Could not create the business." as the
 * only explanation.
 */

let userId: string
const created: string[] = []
/** Unique per run, so a re-run does not collide with the previous one's rows. */
const tag = randomBytes(3).toString('hex')

async function make(name: string) {
  const business = await createBusiness(userId, {
    name,
    contactEmail: '',
    contactPhone: '',
    description: '',
  })
  created.push(business.id)
  return business
}

beforeAll(async () => {
  userId = randomBytes(8).toString('hex')
  await db.insert(users).values({ id: userId, name: 'Slug', email: `${userId}@test.local` })
})

afterAll(async () => {
  await db.delete(memberships).where(eq(memberships.userId, userId))
  if (created.length > 0) await db.delete(businesses).where(inArray(businesses.id, created))
  await db.delete(users).where(eq(users.id, userId))
  await pool.end()
})

describe('slugging a new business', () => {
  it('gives the first one the plain slug', async () => {
    const first = await make(`Rahim Store ${tag}`)
    expect(first.slug).toBe(`rahim-store-${tag}`)
  })

  it('does not hand out a slug somebody already has', async () => {
    // The regression. This second name takes `rahim-store-<tag>-3` outright,
    // which is exactly where counting would send the next plain one.
    await make(`Rahim Store ${tag} 3`)

    const third = await make(`Rahim Store ${tag}`)
    expect(third.slug).not.toBe(`rahim-store-${tag}-3`)
  })

  it('keeps them unique however many share a name', async () => {
    for (let i = 0; i < 4; i++) await make(`Rahim Store ${tag}`)

    const rows = await db
      .select({ slug: businesses.slug })
      .from(businesses)
      .where(inArray(businesses.id, created))

    const slugs = rows.map((row) => row.slug)
    expect(new Set(slugs).size).toBe(slugs.length)
  })

  it('still produces something usable from a name with no latin letters', async () => {
    // Bengali shop names are the point of the product, and they slugify to
    // nothing at all. A blank slug would be both ugly and, on the second one,
    // a unique-index violation.
    const bengali = await make('রহিম স্টোর')
    expect(bengali.slug.length).toBeGreaterThan(0)

    const second = await make('করিম স্টোর')
    expect(second.slug).not.toBe(bengali.slug)
  })

  it('refuses a name that is not a name', async () => {
    await expect(make(' x ')).rejects.toThrow()
  })
})
