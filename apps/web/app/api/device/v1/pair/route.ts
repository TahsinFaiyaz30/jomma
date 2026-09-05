import { z } from 'zod'
import { requireDeviceIpAllowed } from '@/lib/api/device-guard'
import { ApiError } from '@/lib/api/errors'
import { enforceRateLimit, parseBody, route } from '@/lib/api/handler'
import { claimPairingCode } from '@/lib/services/devices'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const pairSchema = z.object({
  /*
   * 32 random bytes as base64url is 43 characters. The bounds are wide enough
   * that a future length change does not need a coordinated app release, and
   * tight enough that the argon2 verify is never handed a megabyte.
   */
  code: z
    .string()
    .trim()
    .min(20)
    .max(200)
    .regex(/^[A-Za-z0-9_-]+$/, 'A pairing code is url-safe base64.'),
})

/**
 * POST /device/v1/pair
 *
 * Redeems the one-time code from a provisioning QR, whichever way the app got
 * hold of it: its own scanner, or an App Link opened by some other scanner app.
 * Both paths end here, so there is one place where a code is burned.
 *
 * Unauthenticated, necessarily — a device being provisioned has no credential
 * yet, and the code *is* the credential. What keeps that safe:
 *
 *   - 256 bits of entropy, so it cannot be guessed.
 *   - Fifteen minutes, so a stale QR in a chat log stops working.
 *   - A conditional burn inside a transaction, so two phones racing the same QR
 *     cannot both come away with a valid token.
 *   - IP rate limiting, since there is no device identity to key on yet.
 *
 * Supersedes `POST /device/v1/provision`, which took a device id alongside its
 * token. That shape cannot work here: the QR has to be a bare URL for a
 * third-party scanner to open it, so the code must locate its own device.
 */
export const POST = route(async (request, context) => {
  requireDeviceIpAllowed(context)
  enforceRateLimit(context, 'device:heartbeat', context.ip ?? 'unknown')

  const body = await parseBody(request, pairSchema)

  try {
    const result = await claimPairingCode({ code: body.code, ip: context.ip })

    context.log.info({ deviceId: result.deviceId }, 'device paired')

    return {
      status: 200,
      body: {
        device_token: result.deviceToken,
        device_id: result.deviceId,
        account: result.account,
        request_id: context.requestId,
      },
    }
  } catch (error) {
    // Expired, already claimed, never existed — one answer for all of them.
    // Anything more specific tells someone holding a stale code which part to
    // change.
    context.log.warn({ err: error, ip: context.ip }, 'pairing rejected')
    throw ApiError.unauthorized('That pairing code is not valid.')
  }
})
