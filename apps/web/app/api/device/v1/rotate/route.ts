import { authenticateDevice } from '@/lib/api/auth'
import { requireDeviceIpAllowed } from '@/lib/api/device-guard'
import { ApiError } from '@/lib/api/errors'
import { enforceRateLimit, route } from '@/lib/api/handler'
import { bearerToken, deviceTokenPrefix } from '@/lib/auth/tokens'
import { completeTokenRotation } from '@/lib/services/devices'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /device/v1/rotate
 *
 * The device swapping its own token, after the server asked it to via a
 * `rotate_token` command on a heartbeat.
 *
 * Device-initiated on purpose. The new plaintext can only be handed to whoever
 * is already holding the current token, so the alternatives were storing a
 * plaintext token for the device to collect later, or invalidating the old one
 * the moment an admin clicked a button and hoping the phone noticed. Neither is
 * acceptable on a device that is the only thing watching for incoming money.
 *
 * Revocation is the immediate one. Rotation is the orderly one.
 */
export const POST = route(async (request, context) => {
  requireDeviceIpAllowed(context)
  const device = await authenticateDevice(request)
  enforceRateLimit(context, 'device:heartbeat', device.rateKey)

  // Authenticated above, so this is the prefix of a token that just verified.
  const presented = bearerToken(request.headers.get('authorization'))
  if (!presented) throw ApiError.unauthorized()

  try {
    const { deviceToken } = await completeTokenRotation({
      deviceId: device.deviceId,
      currentPrefix: deviceTokenPrefix(presented),
    })

    context.log.info({ deviceId: device.deviceId }, 'device rotated its token')

    return {
      status: 200,
      body: { device_token: deviceToken, request_id: context.requestId },
    }
  } catch (error) {
    // A second rotation attempt with an already-swapped token. The device
    // already has its new one; nothing to do.
    context.log.warn({ err: error, deviceId: device.deviceId }, 'rotation conflict')
    throw ApiError.unauthorized('That token has already been rotated.')
  }
})
