import { authenticateDevice } from '@/lib/api/auth'
import { requireDeviceIpAllowed } from '@/lib/api/device-guard'
import { enforceRateLimit, parseBody, route } from '@/lib/api/handler'
import { captureBatchSchema } from '@/lib/api/schemas'
import { ingestCaptures } from '@/lib/services/capture'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /device/v1/capture
 *
 * Batched: after a network outage the device flushes its whole local queue in
 * one request rather than hammering the endpoint.
 *
 * Every result — `accepted`, `duplicate`, `unparsed` — means the device may mark
 * the item sent and drop it from its queue. The server has the raw text and owns
 * it now.
 */
export const POST = route(async (request, context) => {
  requireDeviceIpAllowed(context)
  const device = await authenticateDevice(request)
  enforceRateLimit(context, 'device:capture', device.rateKey)

  const { captures } = await parseBody(request, captureBatchSchema)

  const results = await ingestCaptures({
    deviceId: device.deviceId,
    receivingAccountId: device.receivingAccountId,
    provider: device.provider,
    requestId: context.requestId,
    captures: captures.map((capture) => ({
      localId: capture.local_id,
      source: capture.source,
      packageName: capture.package ?? null,
      raw: capture.raw,
      capturedAt: capture.captured_at ? new Date(capture.captured_at) : null,
    })),
  })

  return {
    status: 200,
    body: {
      results,
      // The device clock drifts; this is how it learns by how much.
      server_time: new Date().toISOString(),
      request_id: context.requestId,
    },
  }
})
