import { randomUUID } from 'node:crypto'
import { env } from '@jomma/shared/env'
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { db } from '@/lib/db/client'
import { accounts, sessions, users, verifications } from '@/lib/db/schema/auth'

/**
 * Dashboard authentication.
 *
 * Admin-only, email and password, **no public signup**. AGENTS.md is explicit
 * that this is a small admin user count with no self-registration — an open
 * signup route on a tool that can approve payments is not a feature.
 *
 * Accounts are created by `pnpm db:seed` or by an existing admin.
 */
export const auth = betterAuth({
  appName: 'Jomma',
  secret: env().AUTH_SECRET,
  baseURL: env().APP_URL,

  /*
   * Better Auth rejects a sign-in whose Origin does not match `baseURL`, which
   * is right in production and a trap in development: run `PORT=3100 pnpm dev`
   * against an APP_URL of :3000 and every login fails with what looks like a
   * wrong password.
   *
   * In development, trust any localhost port. In production, trust APP_URL and
   * nothing else.
   */
  trustedOrigins:
    env().NODE_ENV === 'development'
      ? [env().APP_URL, 'http://localhost:*', 'http://127.0.0.1:*']
      : [env().APP_URL],

  database: drizzleAdapter(db, {
    provider: 'pg',
    schema: { user: users, session: sessions, account: accounts, verification: verifications },
  }),

  emailAndPassword: {
    enabled: true,
    // The whole point. `POST /api/auth/sign-up/email` returns an error.
    disableSignUp: true,
    minPasswordLength: 12,
    requireEmailVerification: false,
  },

  session: {
    // A payments dashboard left open on a shop counter should not stay signed in
    // for a month.
    expiresIn: 60 * 60 * 12,
    updateAge: 60 * 60,
    cookieCache: { enabled: true, maxAge: 60 * 5 },
  },

  advanced: {
    database: {
      // `payment_audit.actor_id` is a uuid column. Better Auth defaults to its
      // own id format, so generate uuids and the audit trail can point straight
      // at a user without a translation table.
      generateId: () => randomUUID(),
    },
    useSecureCookies: env().NODE_ENV === 'production',
  },

  user: {
    additionalFields: {
      role: { type: 'string', defaultValue: 'admin', input: false },
    },
  },

  rateLimit: {
    enabled: true,
    window: 60,
    max: 20,
  },
})

export type Session = typeof auth.$Infer.Session
