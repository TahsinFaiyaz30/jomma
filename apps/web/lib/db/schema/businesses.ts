import { relations } from 'drizzle-orm'
import { index, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core'
import { createdAt, fkId, primaryId, timestampTz, updatedAt } from './_shared'
import { businessStatusEnum, membershipRoleEnum } from './enums'

/**
 * A merchant. The tenant boundary.
 *
 * Jomma is deployed two ways and this table is what lets one codebase serve
 * both. Self-hosted, a shop runs its own instance and there is exactly one of
 * these; as a service, many unrelated merchants share one instance and must not
 * be able to see each other at all. Those are the same product with a different
 * number of rows, and the moment they become two code paths one of them starts
 * rotting — the single-tenant one, because it is the one nobody is attacking.
 *
 * So single-tenant mode is not a special case in the queries. It is one
 * business that every user belongs to. `JOMMA_MODE` decides what the dashboard
 * *shows* — no switcher, no signup, no business column anywhere — but never
 * what the queries *do*. See lib/tenancy.
 *
 * What hangs off this directly is deliberately short. `apps` and
 * `receiving_accounts` carry `business_id`; everything else reaches it through
 * one of those two, because a payment belongs to a business by virtue of the
 * storefront that created it and a capture by virtue of the number it arrived
 * on. Copying the id into all fifteen tables would buy a shorter join and cost
 * fifteen more places for it to be wrong.
 */
export const businesses = pgTable(
  'businesses',
  {
    id: primaryId(),
    name: text('name').notNull(),

    /**
     * URL-safe handle. Unique, because in service mode it appears in paths and
     * in invitation copy, and two merchants called "Rahim Store" is not
     * hypothetical.
     */
    slug: text('slug').notNull(),

    /**
     * `pending` until a platform admin approves it, and pending cannot receive
     * money — see BUSINESS_STATUSES. Defaulting to anything else would mean a
     * fresh signup could route real payments through a personal bKash number
     * before a human had looked at them once.
     */
    status: businessStatusEnum('status').notNull().default('pending'),

    /**
     * Why it is not live. Shown to its members instead of a dashboard that is
     * simply empty and unexplained — "rejected: the number you gave belongs to
     * another merchant" is actionable, a blank screen is a support ticket.
     */
    statusReason: text('status_reason'),

    /** What the merchant said they do, for whoever has to make the decision. */
    contactEmail: text('contact_email'),
    contactPhone: text('contact_phone'),
    description: text('description'),

    /** Set on approval or rejection, with the platform admin who did it. */
    reviewedAt: timestampTz('reviewed_at'),
    reviewedBy: text('reviewed_by'),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('ux_businesses_slug').on(table.slug),
    index('ix_businesses_status').on(table.status),
  ],
)

/**
 * Who may see a business, and what they may do to it.
 *
 * A join table rather than a `business_id` on `user`, because staff move: a
 * bookkeeper doing the accounts for two shops is the ordinary case in the
 * market this is built for, not an edge case to be solved later by making them
 * hold two logins.
 *
 * Roles are deliberately three, and the boundaries are about money rather than
 * seniority:
 *
 *   owner   — everything, including billing, members, and deleting the business
 *   admin   — everything operational: accounts, devices, keys, approving payments
 *   viewer  — reads the dashboard and nothing else
 *
 * `viewer` is the one that earns its place. Somebody has to be able to watch the
 * feed during a shift without being able to approve a payment into existence.
 */
export const memberships = pgTable(
  'memberships',
  {
    id: primaryId(),

    /**
     * Better Auth owns `user.id` and types it `text`, so this cannot be `fkId`.
     * The reference is real all the same — a deleted user takes their
     * memberships with them.
     */
    userId: text('user_id').notNull(),

    businessId: fkId('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),

    role: membershipRoleEnum('role').notNull().default('admin'),

    /** Who added them, for the audit trail. Null for the seeded first owner. */
    invitedBy: text('invited_by'),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    // One row per person per business. Without this, granting someone access
    // twice silently doubles their row count and any join that touches
    // memberships starts returning duplicates.
    uniqueIndex('ux_memberships_user_business').on(table.userId, table.businessId),
    index('ix_memberships_user').on(table.userId),
    index('ix_memberships_business').on(table.businessId, table.role),
  ],
)

/**
 * An outstanding invitation to join a business.
 *
 * Separate from `memberships` because the invitee may not have an account yet,
 * and a membership row pointing at a user that does not exist is a foreign key
 * waiting to fail. The token is hashed like every other credential here: an
 * invitation link is a bearer credential for whoever holds it.
 */
export const invitations = pgTable(
  'invitations',
  {
    id: primaryId(),
    businessId: fkId('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    role: membershipRoleEnum('role').notNull().default('admin'),

    /** SHA-256 of the token in the link. Looked up by, so it cannot be Argon2. */
    tokenHash: text('token_hash').notNull(),

    invitedBy: text('invited_by'),
    expiresAt: timestampTz('expires_at').notNull(),
    acceptedAt: timestampTz('accepted_at'),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('ux_invitations_token').on(table.tokenHash),
    // One open invitation per address per business. Re-inviting replaces.
    uniqueIndex('ux_invitations_business_email').on(table.businessId, table.email),
    index('ix_invitations_business').on(table.businessId),
  ],
)

export const businessesRelations = relations(businesses, ({ many }) => ({
  memberships: many(memberships),
  invitations: many(invitations),
}))

export const membershipsRelations = relations(memberships, ({ one }) => ({
  business: one(businesses, {
    fields: [memberships.businessId],
    references: [businesses.id],
  }),
}))

export const invitationsRelations = relations(invitations, ({ one }) => ({
  business: one(businesses, {
    fields: [invitations.businessId],
    references: [businesses.id],
  }),
}))
