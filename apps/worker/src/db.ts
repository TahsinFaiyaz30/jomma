import { env } from '@jomma/shared/env'
import * as schema from '@jomma/web/db/schema'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'

/**
 * The worker's own pool.
 *
 * It shares the schema definition with the web app — one source of truth for
 * table shapes — but not the connection. Two processes, two pools, so a stuck
 * job cannot starve the API of connections.
 */
export const pool = new Pool({
  connectionString: env().DATABASE_URL,
  max: env().DATABASE_POOL_MAX,
  idleTimeoutMillis: 30_000,
})

export const db = drizzle(pool, { schema, casing: 'snake_case' })
export { schema }
