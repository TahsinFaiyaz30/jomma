import 'server-only'

import { type BusinessStatus, isBusinessLive, type MembershipRole } from '@jomma/shared'
import { isServiceMode } from '@jomma/shared/env'
import { and, asc, eq } from 'drizzle-orm'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { db } from '@/lib/db/client'
import { businesses, memberships } from '@/lib/db/schema'
import { ensureSingleBusiness } from '@/lib/services/businesses'
import { type AdminUser, requireAdmin } from './session'

/**
 * Which business a request is acting on, and whether it is allowed to.
 *
 * Every dashboard read and every mutation goes through here. The rule the rest
 * of the codebase depends on is narrow and absolute: a service function that
 * touches tenant data takes a `businessId`, and the only place that value comes
 * from is this file, after a membership check. Nothing derives it from a query
 * parameter, a form field, or a path segment — those are all attacker-supplied,
 * and an id is exactly the kind of thing that looks harmless in a URL.
 *
 * Single-tenant mode is not a bypass. It resolves to the one business the same
 * way, through the same membership row. A mode that skipped the check would be
 * the mode where a missing check goes unnoticed, because it is the one nobody
 * is trying to break.
 */

export interface ActiveBusiness {
  id: string
  name: string
  slug: string
  status: BusinessStatus
  statusReason: string | null
  /** What the signed-in user may do here. */
  role: MembershipRole
  /** Whether this business may actually move money. */
  live: boolean
}

/** The cookie remembering which business was last open. Service mode only. */
const ACTIVE_BUSINESS_COOKIE = 'jomma_business'

/** Everything the signed-in user belongs to, oldest first so the order is stable. */
export async function listBusinessesFor(userId: string): Promise<ActiveBusiness[]> {
  const rows = await db
    .select({
      id: businesses.id,
      name: businesses.name,
      slug: businesses.slug,
      status: businesses.status,
      statusReason: businesses.statusReason,
      role: memberships.role,
    })
    .from(memberships)
    .innerJoin(businesses, eq(memberships.businessId, businesses.id))
    .where(eq(memberships.userId, userId))
    .orderBy(asc(businesses.createdAt))

  return rows.map((row) => ({ ...row, live: isBusinessLive(row.status) }))
}

/**
 * The business this request is acting on, or null if the user has none yet.
 *
 * In service mode that is a real state rather than an error: someone who has
 * just signed up has an account and no business, and the answer is to send them
 * to create one — not to log them out of a dashboard they were never in.
 */
export async function getActiveBusiness(user: AdminUser): Promise<ActiveBusiness | null> {
  let owned = await listBusinessesFor(user.id)

  /*
   * Self-hosted, having no business is a state that should not be reachable, so
   * fix it rather than report it. Otherwise first run deadlocks: the dashboard
   * sends someone with no business to the setup wizard, and the wizard needs a
   * business to put anything in.
   */
  if (owned.length === 0 && !isServiceMode()) {
    await ensureSingleBusiness(user.id)
    owned = await listBusinessesFor(user.id)
  }

  if (owned.length === 0) return null

  // Self-hosted: there is one, and remembering a choice nobody made is noise.
  if (!isServiceMode()) return owned[0] ?? null

  const preferred = (await cookies()).get(ACTIVE_BUSINESS_COOKIE)?.value

  // Falls back rather than failing when the cookie names something they have
  // been removed from, or a business that no longer exists. A stale cookie
  // should not be able to lock somebody out of the businesses they do have.
  return owned.find((business) => business.id === preferred) ?? owned[0] ?? null
}

/**
 * The business this request is acting on, or a redirect.
 *
 * Where it sends someone is the useful part. No business at all means they need
 * to create one; a business that is not live means they need to be told why,
 * rather than shown a dashboard where every number is zero and nothing works
 * for reasons the screen never mentions.
 */
export async function requireBusiness(): Promise<{ user: AdminUser; business: ActiveBusiness }> {
  const user = await requireAdmin()
  const business = await getActiveBusiness(user)

  if (!business) redirect(isServiceMode() ? '/businesses/new' : '/setup')
  return { user, business }
}

/**
 * As `requireBusiness`, but refuses anything that is not approved.
 *
 * Used by the routes that move money or hand out credentials — creating a live
 * API key, pairing a device, taking an intent. Reading the dashboard is
 * deliberately not gated this way: a merchant waiting on approval should be
 * able to look around and get set up, and only be stopped at the point where
 * real money would start arriving.
 */
export async function requireLiveBusiness(): Promise<{
  user: AdminUser
  business: ActiveBusiness
}> {
  const context = await requireBusiness()
  if (!context.business.live) redirect('/pending')
  return context
}

/** Roles that may change things, as opposed to watch them. */
const WRITE_ROLES: MembershipRole[] = ['owner', 'admin']

export function canWrite(role: MembershipRole): boolean {
  return WRITE_ROLES.includes(role)
}

export function canManageMembers(role: MembershipRole): boolean {
  return role === 'owner'
}

/**
 * Asserts the signed-in user may change something in the active business.
 *
 * Throws rather than redirects: this guards server actions, where a redirect
 * would look to the caller like the action having quietly succeeded.
 */
export async function requireWriteAccess(): Promise<{
  user: AdminUser
  business: ActiveBusiness
}> {
  const context = await requireBusiness()
  if (!canWrite(context.business.role)) {
    throw new Error('This account has read-only access to this business.')
  }
  return context
}

/**
 * Confirms a user really belongs to a business before it is made active.
 *
 * The switcher posts an id, and an id in a request body is a claim rather than
 * a fact. Without this check the switcher would be a way to read any business
 * on the instance by guessing a uuid.
 */
export async function setActiveBusiness(userId: string, businessId: string): Promise<boolean> {
  const [membership] = await db
    .select({ id: memberships.id })
    .from(memberships)
    .where(and(eq(memberships.userId, userId), eq(memberships.businessId, businessId)))
    .limit(1)

  if (!membership) return false

  ;(await cookies()).set(ACTIVE_BUSINESS_COOKIE, businessId, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
  })
  return true
}

/** Clears the remembered business, e.g. after leaving one. */
export async function clearActiveBusiness(): Promise<void> {
  ;(await cookies()).delete(ACTIVE_BUSINESS_COOKIE)
}
