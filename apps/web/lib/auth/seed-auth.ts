import { randomUUID } from 'node:crypto'
import { env } from '@jomma/shared/env'
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { db } from '@/lib/db/client'
import { accounts, sessions, users, verifications } from '@/lib/db/schema/auth'

/**
 * A Better Auth instance with signup enabled, for `pnpm db:seed` only.
 *
 * The real instance in ./auth.ts has `disableSignUp: true`, which is the point —
 * nothing reachable over HTTP can create an account. But something has to create
 * the first admin, and reaching into the internal adapter or hashing a password
 * by hand would couple the seed to Better Auth's private surface.
 *
 * So: same database, same tables, same scrypt parameters, signup on. This module
 * is never imported by anything that serves a request, and there is no route
 * mounted on it.
 */
export const seedAuth = betterAuth({
  appName: 'Jomma',
  secret: env().AUTH_SECRET,
  baseURL: env().APP_URL,

  database: drizzleAdapter(db, {
    provider: 'pg',
    schema: { user: users, session: sessions, account: accounts, verification: verifications },
  }),

  emailAndPassword: {
    enabled: true,
    disableSignUp: false,
    minPasswordLength: 12,
  },

  advanced: {
    database: { generateId: () => randomUUID() },
  },
})
