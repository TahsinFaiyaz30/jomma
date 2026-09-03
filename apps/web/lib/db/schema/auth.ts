import { boolean, index, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core'
import { createdAt, timestampTz, updatedAt } from './_shared'

/**
 * Better Auth tables, for the dashboard only.
 *
 * These are separate from `apps` and `api_keys` on purpose. An admin signing in
 * to the dashboard and a client app calling `/v1/intents` are different
 * principals with different credentials, and collapsing them would mean a
 * leaked API key could reach the dashboard.
 *
 * Column names follow Better Auth's expectations rather than this codebase's
 * conventions — the library reads and writes them directly.
 */

export const users = pgTable(
  'user',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    email: text('email').notNull(),
    emailVerified: boolean('email_verified').notNull().default(false),
    image: text('image'),
    /** Only ever set from the seed or by another admin. No public signup. */
    role: text('role').notNull().default('admin'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [uniqueIndex('ux_user_email').on(table.email)],
)

export const sessions = pgTable(
  'session',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    token: text('token').notNull(),
    expiresAt: timestampTz('expires_at').notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('ux_session_token').on(table.token),
    index('ix_session_user').on(table.userId),
  ],
)

export const accounts = pgTable(
  'account',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    accessTokenExpiresAt: timestampTz('access_token_expires_at'),
    refreshTokenExpiresAt: timestampTz('refresh_token_expires_at'),
    scope: text('scope'),
    idToken: text('id_token'),
    /** Better Auth hashes this itself (scrypt). */
    password: text('password'),
    /**
     * Written by the sign-up route as `createLocalAccountIssuer('credential')`.
     * Their schema generator does not emit it, but the runtime writes it and
     * fails hard if the column is missing.
     */
    issuer: text('issuer'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [index('ix_account_user').on(table.userId)],
)

export const verifications = pgTable(
  'verification',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestampTz('expires_at').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [index('ix_verification_identifier').on(table.identifier)],
)

/** The uuid Better Auth's text ids map onto for `payment_audit.actor_id`. */
export const authSchema = { users, sessions, accounts, verifications }
