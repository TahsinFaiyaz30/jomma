import { z } from 'zod'
import { requireDeviceIpAllowed } from '@/lib/api/device-guard'
import { ApiError } from '@/lib/api/errors'
import { enforceRateLimit, parseBody, route } from '@/lib/api/handler'
import { claimProvisioning } from '@/lib/services/devices'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const provisionSchema = z.object({
  device_id: z.uuid(),
  provisioning_token: z.string().trim().min(10).max(200),
})

/**
 * POST /device/v1/provision
 *
 * The one endpoint a device can reach without a device token, because it does
 * not have one yet. The one-time provisioning value from the QR is the only
 * credential, it is hashed at rest, it expires in fifteen minutes, and claiming
 * it is a conditional update so two phones scanning the same QR cannot both end
 * up holding a valid token.
 */
export const POST = route(async (request, context) => {
  requireDeviceIpAllowed(context)
  // Keyed by IP rather than device, since there is no device identity yet.
  enforceRateLimit(context, 'device:heartbeat', context.ip ?? 'unknown')

  const body = await parseBody(request, provisionSchema)

  try {
    const result = await claimProvisioning({
      deviceId: body.device_id,
      provisioningToken: body.provisioning_token,
      ip: context.ip,
    })

    context.log.info({ deviceId: result.deviceId }, 'device provisioned')

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
    // Expired, already claimed, wrong token — all the same answer. Anything more
    // specific tells someone holding a stale QR which part to change.
    context.log.warn({ err: error, ip: context.ip }, 'provisioning rejected')
    throw ApiError.unauthorized('That provisioning code is not valid.')
  }
})
