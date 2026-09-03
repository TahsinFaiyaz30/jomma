import { sql } from 'drizzle-orm'
import { integer, timestamp, uuid } from 'drizzle-orm/pg-core'

/**
 * Column helpers.
 *
 * Postgres 18 ships `uuidv7()` in core — no extension, no application-side id
 * generation, and the ids sort by creation time so `ORDER BY id` is a valid
 * chronological ordering on every table.
 */

export const primaryId = () => uuid('id').primaryKey().default(sql`uuidv7()`)

export const fkId = (name: string) => uuid(name)

/** Server clock. Never a phone clock — see the `received_at` rule in AGENTS.md. */
export const createdAt = () =>
  timestamp('created_at', { withTimezone: true }).notNull().defaultNow()

export const updatedAt = () =>
  timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date())

export const timestampTz = (name: string) => timestamp(name, { withTimezone: true })

/**
 * Money. Always an integer count of poisha (৳1 = 100 poisha), never a float and
 * never a decimal string. int4 tops out at ৳21,474,836.47, comfortably above any
 * single personal-account MFS transaction.
 */
export const poisha = (name: string) => integer(name)
