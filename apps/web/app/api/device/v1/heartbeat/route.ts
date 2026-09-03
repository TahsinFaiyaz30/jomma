import type { DeviceCommand } from '@jomma/shared'
import { eq } from 'drizzle-orm'
import { authenticateDevice } from '@/lib/api/auth'
import { requireDeviceIpAllowed } from '@/lib/api/device-guard'
import { enforceRateLimit, parseBody, route } from '@/lib/api/handler'
import { heartbeatSchema } from '@/lib/api/schemas'
import { db } from '@/lib/db/client'
import { devices, notifierEvents, receivingAccounts } from '@/lib/db/schema'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /device/v1/heartbeat — every 5 minutes.
 *
 * Alerting on the *gap* is the worker's job; this endpoint only records the
 * beat. That split matters: a phone that is switched off cannot tell you it is
 * switched off, so absence has to be detected from the server side.
 *
 * The response drains any queued commands. Commands are consumed exactly once —
 * a `rotate_token` delivered twice would leave the device holding a token the
 * server has already replaced.
 */
export const POST = route(async (request, context) => {
  requireDeviceIpAllowed(context)
  const device = await authenticateDevice(request)
  enforceRateLimit(context, 'device:heartbeat', device.rateKey)

  const body = await parseBody(request, heartbeatSchema)
  const now = new Date()

  const commands = await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(devices)
      .set({
        lastHeartbeatAt: now,
        battery: body.battery ?? null,
        charging: body.charging ?? null,
        network: body.network ?? null,
        queueDepth: body.queue_depth ?? null,
        permissions: body.permissions ?? null,
        appVersion: body.app_version ?? null,
        lastSeenIp: context.ip,
        pendingCommands: [],
      })
      .where(eq(devices.id, device.deviceId))
      .returning({ pending: devices.pendingCommands })

    await tx
      .update(receivingAccounts)
      .set({ lastHeartbeatAt: now })
      .where(eq(receivingAccounts.id, device.receivingAccountId))

    await tx.insert(notifierEvents).values({
      receivingAccountId: device.receivingAccountId,
      deviceId: device.deviceId,
      kind: 'heartbeat',
      severity: 'low',
      payload: {
        battery: body.battery ?? null,
        charging: body.charging ?? null,
        network: body.network ?? null,
        queue_depth: body.queue_depth ?? null,
        app_version: body.app_version ?? null,
      },
    })

    // A permission silently revoked by an OS update is the classic way this
    // system goes quiet without anyone noticing.
    const lostPermissions = Object.entries(body.permissions ?? {})
      .filter(([, granted]) => granted === false)
      .map(([name]) => name)

    if (lostPermissions.length > 0) {
      await tx.insert(notifierEvents).values({
        receivingAccountId: device.receivingAccountId,
        deviceId: device.deviceId,
        kind: 'permission_lost',
        severity: 'critical',
        detail: lostPermissions.join(', '),
        payload: { permissions: body.permissions },
      })
    }

    return (updated?.pending ?? []) as DeviceCommand[]
  })

  return {
    status: 200,
    body: {
      ok: true,
      commands,
      server_time: now.toISOString(),
      request_id: context.requestId,
    },
  }
})
