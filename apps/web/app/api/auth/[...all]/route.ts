import { toNextJsHandler } from 'better-auth/next-js'
import { auth } from '@/lib/auth/auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Better Auth's own routes. Sign-up is disabled in the config, so the only
 * useful endpoints here are sign-in, sign-out, and session.
 */
export const { GET, POST } = toNextJsHandler(auth)
