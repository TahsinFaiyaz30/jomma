import 'server-only'

import type { PlatformRole } from '@jomma/shared'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { auth } from './auth'

export interface AdminUser {
  id: string
  name: string
  email: string
  /**
   * Authority over the *instance*, not over any business. A `platform_admin`
   * approves and suspends merchants; it grants no access to their payments.
   * See PLATFORM_ROLES.
   */
  role: PlatformRole
}

/** The signed-in user, or null. Does not redirect. */
export async function getAdmin(): Promise<AdminUser | null> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) return null

  // Anything unrecognised is treated as the least-privileged role rather than
  // trusted. A role column that has drifted — an old 'admin' left by a partial
  // migration, say — must not read as platform authority by accident.
  const raw = (session.user as { role?: string }).role
  const role: PlatformRole = raw === 'platform_admin' ? 'platform_admin' : 'member'

  return { id: session.user.id, name: session.user.name, email: session.user.email, role }
}

/**
 * The signed-in user, or a redirect to the login page.
 *
 * Every dashboard route and every mutating server action calls this. The audit
 * trail records the returned id, so "who approved this payment" always has an
 * answer.
 *
 * Note what this does *not* establish: which business they are acting on. That
 * is a separate question with a separate check — see lib/auth/tenancy.
 */
export async function requireAdmin(): Promise<AdminUser> {
  const admin = await getAdmin()
  if (!admin) redirect('/login')
  return admin
}

/**
 * The signed-in platform admin, or a redirect.
 *
 * Guards the instance's own console — approving businesses, suspending them,
 * promoting other platform admins. Deliberately unrelated to membership: an
 * operator of the deployment is not thereby entitled to any merchant's takings,
 * and running the platform does not require reading them.
 *
 * Redirects to the dashboard rather than the login page. Somebody signed in
 * without this authority is not unauthenticated, and sending them to a login
 * form they have already passed is a dead end.
 */
export async function requirePlatformAdmin(): Promise<AdminUser> {
  const admin = await requireAdmin()
  if (admin.role !== 'platform_admin') redirect('/')
  return admin
}
