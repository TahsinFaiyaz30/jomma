import { randomUUID } from 'node:crypto'
import { env } from '@jomma/shared/env'
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { db } from '@/lib/db/client'
import { accounts, sessions, users, verifications } from '@/lib/db/schema/auth'

/**
 * Dashboard authentication.
 *
 * Email and password. Whether anyone may register is the one thing
 * `JOMMA_MODE` changes here, and the two answers are both deliberate.
 *
 * Self-hosted (`single`), signup is closed. A shop running this for itself has
 * a known, tiny set of operators, and an open registration route on a tool that
 * can approve payments is not a feature. Accounts come from `pnpm db:seed` or
 * from an existing admin.
 *
 * As a service, signup is open — and it is safe to open precisely because
 * registering buys nothing on its own. A new user is a `member` with no
 * business; the business they then create starts `pending` and cannot receive
 * money until a platform admin approves it. The gate is on the money, not on
 * the account, which is the right place for it: making people wait for a login
 * only teaches them to give up before you have learned anything about them.
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
    // Closed when this instance belongs to one shop; open when it is a service.
    // See the note above for why opening it is not the risk it looks like.
    disableSignUp: env().JOMMA_MODE === 'single',
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
      /*
       * `member`, not `admin`. Public signup exists in service mode, so this
       * default is the difference between a stranger registering and a stranger
       * registering as an operator of the instance. `input: false` keeps a
       * crafted signup body from setting it at all; the only way to become a
       * platform admin is the seed or an existing one promoting you.
       */
      role: { type: 'string', defaultValue: 'member', input: false },
    },
  },

  rateLimit: {
    enabled: true,
    window: 60,
    max: 20,
  },
})

export type Session = typeof auth.$Infer.Session
