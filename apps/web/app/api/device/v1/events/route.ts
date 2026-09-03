import type { AlertSeverity, DeviceReportableEventKind } from '@jomma/shared'
import { authenticateDevice } from '@/lib/api/auth'
import { requireDeviceIpAllowed } from '@/lib/api/device-guard'
import { enforceRateLimit, parseBody, route } from '@/lib/api/handler'
import { deviceEventSchema } from '@/lib/api/schemas'
import { db } from '@/lib/db/client'
import { notifierEvents } from '@/lib/db/schema'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /device/v1/events — the device reporting on itself.
 *
 * Each kind maps to a dashboard alert. Severity is assigned here rather than
 * accepted from the device: a compromised or buggy client must not be able to
 * downgrade its own "I lost notification access" to noise.
 */
const SEVERITY: Record<DeviceReportableEventKind, AlertSeverity> = {
  // The service is running but deaf. Nothing will be captured and nothing will
  // look wrong until money goes missing.
  permission_lost: 'critical',
  // The bridge scrapes a DOM that changes without notice, and a signed-out
  // session must be indistinguishable from a bridge that is down.
  bridge_session_lost: 'critical',
  service_restarted: 'medium',
  boot: 'low',
  parse_hint: 'medium',
}

export const POST = route(async (request, context) => {
  requireDeviceIpAllowed(context)
  const device = await authenticateDevice(request)
  enforceRateLimit(context, 'device:events', device.rateKey)

  const body = await parseBody(request, deviceEventSchema)

  await db.insert(notifierEvents).values({
    receivingAccountId: device.receivingAccountId,
    deviceId: device.deviceId,
    kind: body.kind,
    severity: SEVERITY[body.kind],
    detail: body.detail ?? null,
    payload: body.payload ?? {},
  })

  return { status: 200, body: { ok: true, request_id: context.requestId } }
})
