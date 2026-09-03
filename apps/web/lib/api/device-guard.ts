import { env } from '@jomma/shared/env'
import { ApiError } from './errors'
import type { RequestContext } from './handler'

/**
 * Optional IP allowlist on the device endpoints.
 *
 * Off by default — a shop phone on mobile data has no stable address. It is
 * worth turning on when the phone sits on a fixed connection, as a second layer
 * behind the device token rather than a replacement for it.
 */
export function requireDeviceIpAllowed(context: RequestContext): void {
  const allowlist = env().DEVICE_IP_ALLOWLIST
  if (allowlist.length === 0) return

  if (!context.ip || !allowlist.includes(context.ip)) {
    // Every rejected request is logged with its IP, per AGENTS.md.
    context.log.warn({ ip: context.ip }, 'device request from a non-allowlisted address')
    throw ApiError.unauthorized()
  }
}
