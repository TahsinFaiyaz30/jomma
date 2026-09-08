import { authenticateDevice } from '@/lib/api/auth'
import { requireDeviceIpAllowed } from '@/lib/api/device-guard'
import { enforceRateLimit, route } from '@/lib/api/handler'
import { revokeDevice } from '@/lib/services/devices'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /device/v1/revoke — the phone retiring its own credential.
 *
 * Disconnecting a business on the handset used to be a purely local act: the
 * pairing was forgotten and the server was never told, so the dashboard went on
 * listing an active device that had stopped existing. The merchant's phone
 * looked healthy right up until they noticed no payments had arrived, and the
 * only fix was for somebody to guess and revoke it by hand.
 *
 * ## Why a phone is allowed to do this
 *
 * It is giving something up, not taking something. The credential it revokes is
 * the one it authenticated with, so the worst an attacker holding a stolen
 * device token can achieve is to destroy the token they stole — which is what
 * the operator would want done anyway. There is no other resource to reach:
 * this names nothing and takes no body.
 *
 * The dashboard is left able to tell the two apart. A device that revoked
 * itself is recorded as `actorType: 'device'` and raises "the phone
 * disconnected itself from this business", rather than being indistinguishable
 * from an operator withdrawing trust.
 *
 * Idempotent by consequence rather than by special case: authentication refuses
 * an already-revoked token, so a retry answers 401 and the phone treats that as
 * "already gone", which it is.
 */
export const POST = route(async (request, context) => {
  requireDeviceIpAllowed(context)
  const device = await authenticateDevice(request, context)
  enforceRateLimit(context, 'device:heartbeat', device.rateKey)

  await revokeDevice({ deviceId: device.deviceId, actorId: null, actorType: 'device' })

  context.log.info({ deviceId: device.deviceId }, 'device revoked itself')

  return {
    status: 200,
    body: { ok: true, status: 'revoked', request_id: context.requestId },
  }
})
