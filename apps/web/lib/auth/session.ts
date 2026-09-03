import 'server-only'

import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { auth } from './auth'

export interface AdminUser {
  id: string
  name: string
  email: string
}

/** The signed-in admin, or null. Does not redirect. */
export async function getAdmin(): Promise<AdminUser | null> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) return null
  return { id: session.user.id, name: session.user.name, email: session.user.email }
}

/**
 * The signed-in admin, or a redirect to the login page.
 *
 * Every dashboard route and every mutating server action calls this. The audit
 * trail records the returned id, so "who approved this payment" always has an
 * answer.
 */
export async function requireAdmin(): Promise<AdminUser> {
  const admin = await getAdmin()
  if (!admin) redirect('/login')
  return admin
}
