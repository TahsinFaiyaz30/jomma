import { authenticateDevice } from '@/lib/api/auth'
import { requireDeviceIpAllowed } from '@/lib/api/device-guard'
import { enforceRateLimit, parseBody, route } from '@/lib/api/handler'
import { captureSettingsSchema } from '@/lib/api/schemas'
import { getCaptureSettings, setCaptureSettings } from '@/lib/services/account-admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /device/v1/settings — the phone changing what its account keeps.
 *
 * The other half of the same setting the dashboard edits. Having it on both
 * screens is a convenience, not two systems: this writes the same
 * `receiving_accounts` row, and the dashboard sees it on the next render.
 *
 * Scoped to the device's own account, which is why the body carries no account
 * id. A phone can only ever change the number it was provisioned for, so a
 * stolen token cannot be used to quietly stop a *different* number capturing
 * payments. There is nothing here to escalate with.
 *
 * Last write wins, and that is fine: the values are display preferences over
 * which messages get stored, and the worst a lost update costs is some noise in
 * the feed until someone flips the switch back. Incoming Send Money is not
 * settable from anywhere, so no combination of writes can stop a payment being
 * matched.
 */
export const POST = route(async (request, context) => {
  requireDeviceIpAllowed(context)
  const device = await authenticateDevice(request)
  enforceRateLimit(context, 'device:heartbeat', device.rateKey)

  const settings = await parseBody(request, captureSettingsSchema)

  const saved = await setCaptureSettings({
    accountId: device.receivingAccountId,
    settings,
    actorId: null,
    actorType: 'device',
  })

  context.log.info({ deviceId: device.deviceId, capture: saved }, 'device changed capture settings')

  return {
    status: 200,
    body: { ok: true, capture: saved, request_id: context.requestId },
  }
})

/**
 * The app reads this on open so its switches show the truth rather than
 * whatever they were when the last heartbeat landed — up to fifteen minutes
 * ago, and longer if the phone was asleep.
 */
export const GET = route(async (request, context) => {
  requireDeviceIpAllowed(context)
  const device = await authenticateDevice(request)
  enforceRateLimit(context, 'device:heartbeat', device.rateKey)

  const capture = await getCaptureSettings(device.receivingAccountId)

  return {
    status: 200,
    body: { ok: true, capture, request_id: context.requestId },
  }
})
