import type { BusinessStatus, MembershipRole } from '@jomma/shared'
import { and, asc, count, desc, eq, sql } from 'drizzle-orm'
import { type Database, db, type Tx } from '@/lib/db/client'
import {
  apiKeys,
  apps,
  businesses,
  devices,
  incomingPayments,
  memberships,
  notifierEvents,
  paymentIntents,
  receivingAccounts,
  webhookDeliveries,
  webhookEndpoints,
} from '@/lib/db/schema'

/**
 * Businesses: creating them, approving them, and answering "whose is this?".
 *
 * The lookups at the top are the ones every other service leans on. They exist
 * as functions rather than as inline joins because the answer has to be
 * identical everywhere — a capture, an intent and a dashboard read must agree
 * about which merchant a row belongs to, and three hand-written joins is three
 * chances to disagree.
 */

/* ── Ownership lookups ─────────────────────────────────────────────────── */

/**
 * The business behind an API key's app.
 *
 * Every client API request resolves tenancy this way: key → app → business. The
 * caller never says which business it is acting for, because a caller that
 * could say would be a caller that could lie.
 */
export async function businessIdForApp(
  appId: string,
  client: Database | Tx = db,
): Promise<string | null> {
  const [row] = await client
    .select({ businessId: apps.businessId })
    .from(apps)
    .where(eq(apps.id, appId))
    .limit(1)

  return row?.businessId ?? null
}

/** As above, but for the paths that only hold an intent id. */
export async function businessIdForIntent(
  intentId: string,
  client: Database | Tx = db,
): Promise<string | null> {
  const [row] = await client
    .select({ businessId: apps.businessId })
    .from(paymentIntents)
    .innerJoin(apps, eq(paymentIntents.appId, apps.id))
    .where(eq(paymentIntents.id, intentId))
    .limit(1)

  return row?.businessId ?? null
}

/** The business a captured payment arrived for, via the number it landed on. */
export async function businessIdForReceivingAccount(
  receivingAccountId: string,
  client: Database | Tx = db,
): Promise<string | null> {
  const [row] = await client
    .select({ businessId: receivingAccounts.businessId })
    .from(receivingAccounts)
    .where(eq(receivingAccounts.id, receivingAccountId))
    .limit(1)

  return row?.businessId ?? null
}

/* ── Ownership assertions ──────────────────────────────────────────────── */

/**
 * Refuses a row that does not belong to the business acting on it.
 *
 * These guard the by-id mutations — disable this account, revoke that key —
 * which are where multi-tenancy actually leaks. Resolving the business from the
 * session is only half of it: the *other* argument is a row id straight out of
 * a form, and nothing about `disableAccount(id)` stops that id naming a
 * different merchant's phone.
 *
 * Deliberately identical failures for "does not exist" and "is not yours".
 * Distinguishing them turns any of these into an oracle for whether a given
 * uuid is in use on the instance.
 */
export async function assertOwnsReceivingAccount(
  businessId: string,
  receivingAccountId: string,
  client: Database | Tx = db,
): Promise<void> {
  const [row] = await client
    .select({ id: receivingAccounts.id })
    .from(receivingAccounts)
    .where(
      and(
        eq(receivingAccounts.id, receivingAccountId),
        eq(receivingAccounts.businessId, businessId),
      ),
    )
    .limit(1)

  if (!row) throw new Error('Unknown account')
}

export async function assertOwnsApp(
  businessId: string,
  appId: string,
  client: Database | Tx = db,
): Promise<void> {
  const [row] = await client
    .select({ id: apps.id })
    .from(apps)
    .where(and(eq(apps.id, appId), eq(apps.businessId, businessId)))
    .limit(1)

  if (!row) throw new Error('Unknown app')
}

/** As above, for a device — reached through the number it is paired to. */
export async function assertOwnsDevice(
  businessId: string,
  deviceId: string,
  client: Database | Tx = db,
): Promise<void> {
  const [row] = await client
    .select({ id: devices.id })
    .from(devices)
    .innerJoin(receivingAccounts, eq(devices.receivingAccountId, receivingAccounts.id))
    .where(and(eq(devices.id, deviceId), eq(receivingAccounts.businessId, businessId)))
    .limit(1)

  if (!row) throw new Error('Unknown device')
}

/**
 * As above, for an alert — reached through the account it was raised against.
 *
 * Events with no account are instance-wide rather than any merchant's, so they
 * are refused here: there is no business that owns them and therefore none that
 * may acknowledge them from a business screen.
 */
export async function assertOwnsNotifierEvent(
  businessId: string,
  eventId: string,
  client: Database | Tx = db,
): Promise<void> {
  const [row] = await client
    .select({ id: notifierEvents.id })
    .from(notifierEvents)
    .innerJoin(receivingAccounts, eq(notifierEvents.receivingAccountId, receivingAccounts.id))
    .where(and(eq(notifierEvents.id, eventId), eq(receivingAccounts.businessId, businessId)))
    .limit(1)

  if (!row) throw new Error('Unknown alert')
}

/** As above, for an API key — reached through the app it authenticates. */
export async function assertOwnsApiKey(
  businessId: string,
  keyId: string,
  client: Database | Tx = db,
): Promise<void> {
  const [row] = await client
    .select({ id: apiKeys.id })
    .from(apiKeys)
    .innerJoin(apps, eq(apiKeys.appId, apps.id))
    .where(and(eq(apiKeys.id, keyId), eq(apps.businessId, businessId)))
    .limit(1)

  if (!row) throw new Error('Unknown key')
}

/** As above, for a webhook endpoint. */
export async function assertOwnsEndpoint(
  businessId: string,
  endpointId: string,
  client: Database | Tx = db,
): Promise<void> {
  const [row] = await client
    .select({ id: webhookEndpoints.id })
    .from(webhookEndpoints)
    .innerJoin(apps, eq(webhookEndpoints.appId, apps.id))
    .where(and(eq(webhookEndpoints.id, endpointId), eq(apps.businessId, businessId)))
    .limit(1)

  if (!row) throw new Error('Unknown endpoint')
}

/**
 * As above, for a delivery.
 *
 * `webhook_deliveries` carries `app_id` directly, so this needs no join through
 * the endpoint — and should not use one, since replaying is exactly the kind of
 * action whose guard wants the shortest path to the truth.
 */
export async function assertOwnsDelivery(
  businessId: string,
  deliveryId: string,
  client: Database | Tx = db,
): Promise<void> {
  const [row] = await client
    .select({ id: webhookDeliveries.id })
    .from(webhookDeliveries)
    .innerJoin(apps, eq(webhookDeliveries.appId, apps.id))
    .where(and(eq(webhookDeliveries.id, deliveryId), eq(apps.businessId, businessId)))
    .limit(1)

  if (!row) throw new Error('Unknown delivery')
}

/** As above, for an intent — reached through the app that created it. */
export async function assertOwnsIntent(
  businessId: string,
  intentId: string,
  client: Database | Tx = db,
): Promise<void> {
  const [row] = await client
    .select({ id: paymentIntents.id })
    .from(paymentIntents)
    .innerJoin(apps, eq(paymentIntents.appId, apps.id))
    .where(and(eq(paymentIntents.id, intentId), eq(apps.businessId, businessId)))
    .limit(1)

  if (!row) throw new Error('Unknown payment')
}

/**
 * As above, for a captured payment — reached through the number it arrived on.
 *
 * This is the one guarding the queue, which is where a mistake would be worst:
 * approving is the action that credits money to an intent, and doing it across
 * a tenant boundary would pay one merchant's order out of another's takings.
 */
export async function assertOwnsIncomingPayment(
  businessId: string,
  paymentId: string,
  client: Database | Tx = db,
): Promise<void> {
  const [row] = await client
    .select({ id: incomingPayments.id })
    .from(incomingPayments)
    .innerJoin(receivingAccounts, eq(incomingPayments.receivingAccountId, receivingAccounts.id))
    .where(and(eq(incomingPayments.id, paymentId), eq(receivingAccounts.businessId, businessId)))
    .limit(1)

  if (!row) throw new Error('Unknown payment')
}

/* ── Creating one ──────────────────────────────────────────────────────── */

export interface NewBusinessInput {
  name: string
  contactEmail?: string | null
  contactPhone?: string | null
  description?: string | null
}

/**
 * A URL-safe handle, uniquified by counting collisions.
 *
 * Bengali names transliterate to nothing under a strict `[a-z0-9]` filter, so a
 * name written in Bengali script would produce an empty slug and then a
 * uniqueness error that says nothing about the real problem. Falling back to
 * `business` keeps that case working — the slug is a URL convenience, not an
 * identifier anyone types.
 */
async function uniqueSlug(name: string, client: Database | Tx): Promise<string> {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'business'

  const [existing] = await client
    .select({ taken: count() })
    .from(businesses)
    .where(sql`${businesses.slug} = ${base} or ${businesses.slug} like ${`${base}-%`}`)

  const taken = existing?.taken ?? 0
  return taken === 0 ? base : `${base}-${taken + 1}`
}

/**
 * Creates a business and makes its creator the owner.
 *
 * Both rows in one transaction, because a business with no members is
 * unreachable — nobody can open it, and nobody can be added to it, since adding
 * members is a thing owners do. Half of this succeeding would leave a row that
 * only a database client could fix.
 *
 * It starts `pending`. See BUSINESS_STATUSES for why the gate is on receiving
 * money rather than on signing up.
 */
export async function createBusiness(
  userId: string,
  input: NewBusinessInput,
  client: Database = db,
): Promise<{ id: string; slug: string }> {
  const name = input.name.trim()
  if (name.length < 2) throw new Error('Give the business a name.')

  return client.transaction(async (tx) => {
    const slug = await uniqueSlug(name, tx)

    const [business] = await tx
      .insert(businesses)
      .values({
        name,
        slug,
        contactEmail: input.contactEmail?.trim() || null,
        contactPhone: input.contactPhone?.trim() || null,
        description: input.description?.trim() || null,
      })
      .returning({ id: businesses.id, slug: businesses.slug })

    if (!business) throw new Error('Could not create the business.')

    await tx.insert(memberships).values({
      userId,
      businessId: business.id,
      role: 'owner',
    })

    return business
  })
}

/**
 * The one business, in self-hosted mode, created on first use.
 *
 * Self-hosted, "which business?" has exactly one answer and the operator should
 * never be asked it. Without this there is a first-run deadlock: the dashboard
 * sends someone with no business to the setup wizard, and the setup wizard
 * needs a business to put anything in.
 *
 * `active`, not `pending`, and that is not a hole in the approval gate. A shop
 * running Jomma on its own server *is* the platform — there is nobody else to
 * approve it, and a self-hosted instance that sat waiting for permission from a
 * reviewer who does not exist would simply never work. The gate exists to stop
 * strangers on a shared instance from moving money through it, which is a
 * question that only arises when the instance is shared.
 *
 * Idempotent under concurrency: two simultaneous first requests both try to
 * insert, one loses on the unique slug, and the loser re-reads rather than
 * failing. Two businesses here would be worse than an error — the instance
 * would silently split in half.
 */
export async function ensureSingleBusiness(userId: string, client: Database = db): Promise<string> {
  const [existing] = await client
    .select({ id: businesses.id })
    .from(businesses)
    .orderBy(asc(businesses.createdAt))
    .limit(1)

  const businessId =
    existing?.id ??
    (await client
      .insert(businesses)
      .values({ name: 'My shop', slug: 'default', status: 'active' })
      .onConflictDoNothing({ target: businesses.slug })
      .returning({ id: businesses.id })
      .then((rows) => rows[0]?.id)) ??
    (await client
      .select({ id: businesses.id })
      .from(businesses)
      .orderBy(asc(businesses.createdAt))
      .limit(1)
      .then((rows) => rows[0]?.id))

  if (!businessId) throw new Error('Could not resolve this instance’s business.')

  // Everyone who can sign in to a self-hosted instance owns it. There is no
  // other business for them to belong to, and a signed-in operator staring at a
  // redirect loop is the alternative.
  await client
    .insert(memberships)
    .values({ userId, businessId, role: 'owner' })
    .onConflictDoNothing({ target: [memberships.userId, memberships.businessId] })

  return businessId
}

/* ── The platform console ──────────────────────────────────────────────── */

export interface BusinessReviewRow {
  id: string
  name: string
  slug: string
  status: BusinessStatus
  statusReason: string | null
  contactEmail: string | null
  contactPhone: string | null
  description: string | null
  createdAt: Date
  reviewedAt: Date | null
  memberCount: number
  accountCount: number
}

/**
 * Every business on the instance, for the platform console.
 *
 * Pending first, then newest — the queue's whole purpose is the decisions
 * waiting to be made, and sorting purely by date buries them under approvals
 * that are already done.
 */
export async function listBusinessesForReview(
  status?: BusinessStatus,
): Promise<BusinessReviewRow[]> {
  const rows = await db
    .select({
      id: businesses.id,
      name: businesses.name,
      slug: businesses.slug,
      status: businesses.status,
      statusReason: businesses.statusReason,
      contactEmail: businesses.contactEmail,
      contactPhone: businesses.contactPhone,
      description: businesses.description,
      createdAt: businesses.createdAt,
      reviewedAt: businesses.reviewedAt,
    })
    .from(businesses)
    .where(status ? eq(businesses.status, status) : undefined)
    .orderBy(
      sql`case when ${businesses.status} = 'pending' then 0 else 1 end`,
      desc(businesses.createdAt),
    )

  /*
   * Counted with grouped aggregates rather than correlated subqueries in a raw
   * `sql` template. Those rendered without their correlation and silently
   * returned zero for every business — a wrong number on a review screen is
   * worse than a missing one, because "0 numbers" reads as "they have not set
   * anything up", which is exactly the sort of thing the decision turns on.
   */
  const [memberCounts, accountCounts] = await Promise.all([
    db
      .select({ businessId: memberships.businessId, total: count() })
      .from(memberships)
      .groupBy(memberships.businessId),
    db
      .select({ businessId: receivingAccounts.businessId, total: count() })
      .from(receivingAccounts)
      .groupBy(receivingAccounts.businessId),
  ])

  const members = new Map(memberCounts.map((row) => [row.businessId, row.total]))
  const accounts = new Map(accountCounts.map((row) => [row.businessId, row.total]))

  return rows.map((row) => ({
    ...row,
    memberCount: members.get(row.id) ?? 0,
    accountCount: accounts.get(row.id) ?? 0,
  }))
}

/**
 * Approves, rejects or suspends a business.
 *
 * A reason is required for everything except approval, and that asymmetry is
 * deliberate: the merchant is shown this text, and "rejected" with no
 * explanation is a support conversation that starts from zero. Approval needs
 * no justification because nothing is being taken away.
 */
export async function reviewBusiness(options: {
  businessId: string
  status: Exclude<BusinessStatus, 'pending'>
  reason?: string | null
  reviewedBy: string
}): Promise<void> {
  const reason = options.reason?.trim() || null

  if (options.status !== 'active' && !reason) {
    throw new Error('Say why. The merchant is shown this.')
  }

  const [updated] = await db
    .update(businesses)
    .set({
      status: options.status,
      statusReason: options.status === 'active' ? null : reason,
      reviewedAt: new Date(),
      reviewedBy: options.reviewedBy,
    })
    .where(eq(businesses.id, options.businessId))
    .returning({ id: businesses.id })

  if (!updated) throw new Error('No such business.')
}

/** How many are waiting, for the badge on the console link. */
export async function pendingBusinessCount(): Promise<number> {
  const [row] = await db
    .select({ waiting: count() })
    .from(businesses)
    .where(eq(businesses.status, 'pending'))

  return row?.waiting ?? 0
}

/* ── Members ───────────────────────────────────────────────────────────── */

export interface MemberRow {
  userId: string
  role: MembershipRole
  createdAt: Date
}

export async function listMembers(businessId: string): Promise<MemberRow[]> {
  return db
    .select({
      userId: memberships.userId,
      role: memberships.role,
      createdAt: memberships.createdAt,
    })
    .from(memberships)
    .where(eq(memberships.businessId, businessId))
    .orderBy(asc(memberships.createdAt))
}

/**
 * Changes a member's role.
 *
 * Refuses to remove the last owner. A business whose only owner has demoted
 * themselves cannot add members, cannot change roles, and cannot be recovered
 * from inside the product — the check is cheap and the alternative is a
 * database session.
 */
export async function setMemberRole(options: {
  businessId: string
  userId: string
  role: MembershipRole
}): Promise<void> {
  await db.transaction(async (tx) => {
    if (options.role !== 'owner') {
      const [owners] = await tx
        .select({ total: count() })
        .from(memberships)
        .where(and(eq(memberships.businessId, options.businessId), eq(memberships.role, 'owner')))

      const [current] = await tx
        .select({ role: memberships.role })
        .from(memberships)
        .where(
          and(
            eq(memberships.businessId, options.businessId),
            eq(memberships.userId, options.userId),
          ),
        )
        .limit(1)

      if (current?.role === 'owner' && (owners?.total ?? 0) <= 1) {
        throw new Error('A business needs at least one owner.')
      }
    }

    await tx
      .update(memberships)
      .set({ role: options.role })
      .where(
        and(eq(memberships.businessId, options.businessId), eq(memberships.userId, options.userId)),
      )
  })
}
