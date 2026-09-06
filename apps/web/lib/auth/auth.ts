import { randomUUID } from 'node:crypto'
import { env } from '@jomma/shared/env'
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { and, eq, sql } from 'drizzle-orm'
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

    /*
     * Where the client's address comes from.
     *
     * Without this, Better Auth cannot resolve one behind a proxy and says so:
     * "falling back to a single shared per-path bucket". It kept working, but
     * as *one* bucket for the whole instance -- so twenty failed logins a
     * minute from anywhere locked every user out of signing in. On a service
     * instance that is an unauthenticated denial of service against every
     * merchant at once, and it costs an attacker twenty requests.
     *
     * `x-forwarded-for` is what Render sets, and every reverse proxy worth the
     * name sets it. It is client-controllable in the sense that a caller can
     * put anything in it, which here means an attacker can spread their own
     * attempts across invented addresses rather than being throttled. That is a
     * strictly better failure than the one it replaces: evading your own limit
     * is not the same as revoking everybody else's, and password auth is not
     * relying on this alone -- scrypt hashing and a twelve-character minimum
     * are doing the actual work.
     */
    ipAddress: {
      ipAddressHeaders: ['x-forwarded-for', 'x-real-ip'],
    },
  },

  user: {
    additionalFields: {
      /*
       * `member`, not `admin`. Public signup exists in service mode, so this
       * default is the difference between a stranger registering and a stranger
       * registering as an operator of the instance. `input: false` keeps a
       * crafted signup body from setting it at all; the only way to become a
       * platform admin is the seed, an existing one promoting you, or being
       * first — see the hook below.
       */
      role: { type: 'string', defaultValue: 'member', input: false },
    },
  },

  databaseHooks: {
    user: {
      create: {
        /**
         * The first account on an empty instance runs it.
         *
         * Without this, a freshly deployed service-mode instance is a dead end:
         * everyone who signs up is a `member`, every business they create sits
         * `pending`, and there is nobody with the authority to approve one. The
         * only way out would be a database client, which is not a bootstrap
         * story anybody should have to be told.
         *
         * The guard is "this is the only account on the instance", not "there
         * is no platform admin". The difference is the whole security argument.
         * Keyed on the absence of an admin, deleting the sole platform admin on
         * an instance with five hundred users would hand the role to whichever
         * stranger signed up next — a privilege escalation reachable by anyone
         * patient enough to watch for it. Keyed on the table being empty, it can
         * only fire on a deployment that has nothing to protect yet.
         *
         * Losing your only admin later is therefore *not* self-healing, and
         * should not be: that is a job for `pnpm db:seed --admin-only` or the
         * database, which is the right amount of friction for taking over an
         * instance holding other people's money.
         */
        after: async (user) => {
          await db
            .update(users)
            .set({ role: 'platform_admin' })
            .where(and(eq(users.id, user.id), sql`(select count(*) from ${users}) = 1`))
        },
      },
    },
  },

  rateLimit: {
    enabled: true,
    window: 60,
    max: 20,
  },
})

export type Session = typeof auth.$Infer.Session
