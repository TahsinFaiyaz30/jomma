import { env } from '@jomma/shared/env'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import * as schema from './schema'

/**
 * One pool per process. Next's dev server re-evaluates modules on every edit, so
 * the pool is stashed on globalThis — without that, a few minutes of hot
 * reloading exhausts `max_connections`.
 */

declare global {
  // eslint-disable-next-line no-var
  var __jommaPool: Pool | undefined
}

function createPool(): Pool {
  const config = env()
  const pool = new Pool({
    connectionString: config.DATABASE_URL,
    max: config.DATABASE_POOL_MAX,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  })

  pool.on('error', (error) => {
    // An idle client erroring must not take the process down.
    console.error('[db] idle client error', error.message)
  })

  return pool
}

export const pool: Pool = globalThis.__jommaPool ?? createPool()
if (process.env.NODE_ENV !== 'production') globalThis.__jommaPool = pool

export const db = drizzle(pool, { schema, casing: 'snake_case' })

export type Database = typeof db

/**
 * Drizzle's transaction callback type. Used by anything that has to run inside
 * the caller's transaction — approval, in particular, must never open its own.
 */
export type Tx = Parameters<Parameters<Database['transaction']>[0]>[0]

export { schema }
