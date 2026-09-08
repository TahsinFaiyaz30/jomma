import type { DeviceCommand } from '@jomma/shared'
import { eq } from 'drizzle-orm'
import { authenticateDevice } from '@/lib/api/auth'
import { requireDeviceIpAllowed } from '@/lib/api/device-guard'
import { enforceRateLimit, parseBody, route } from '@/lib/api/handler'
import { heartbeatSchema } from '@/lib/api/schemas'
import { db } from '@/lib/db/client'
import { devices, notifierEvents, receivingAccounts } from '@/lib/db/schema'
import { getCaptureSettings } from '@/lib/services/account-admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Records permissions the phone says it has lost.
 *
 * Lifted out of the transaction body, which had grown past the point where the
 * shape of it could be taken in at a glance — the lint rule noticed before I
 * did. It is also the one part of a heartbeat that is about something being
 * *wrong*, so it reads better with a name on it.
 *
 * A permission silently revoked by an OS update is the classic way this system
 * goes quiet without anybody noticing, which is why it is critical severity
 * rather than a note.
 */
async function recordLostPermissions(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  device: { deviceId: string; receivingAccountId: string | null },
  permissions: Record<string, boolean> | null,
): Promise<void> {
  const lost = Object.entries(permissions ?? {})
    .filter(([, granted]) => granted === false)
    .map(([name]) => name)

  if (lost.length === 0) return

  await tx.insert(notifierEvents).values({
    receivingAccountId: device.receivingAccountId,
    deviceId: device.deviceId,
    kind: 'permission_lost',
    severity: 'critical',
    detail: lost.join(', '),
    payload: { permissions },
  })
}

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
  const device = await authenticateDevice(request, context)
  enforceRateLimit(context, 'device:heartbeat', device.rateKey)

  const body = await parseBody(request, heartbeatSchema)
  const now = new Date()

  const commands = await db.transaction(async (tx) => {
    /*
     * Read the queue before clearing it.
     *
     * `UPDATE ... RETURNING` in Postgres returns the *new* row, so draining and
     * returning in one statement hands back the empty array it just wrote and
     * every command is silently lost. Two statements in one transaction, with
     * the row locked, is the correct drain.
     */
    const [current] = await tx
      .select({ pending: devices.pendingCommands })
      .from(devices)
      .where(eq(devices.id, device.deviceId))
      .for('update')
      .limit(1)

    await tx
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

        /*
         * Only when the phone actually said something.
         *
         * Spread rather than assigned, because `undefined` here means an app
         * too old to know about SIMs — and writing null for that would erase a
         * list a newer app had reported, leaving the dashboard with nothing to
         * offer while somebody is halfway through adding an account. An empty
         * array is a different statement, "I looked and there are none", and
         * that one is stored.
         */
        ...(body.sims === undefined ? {} : { sims: body.sims, simsReportedAt: now }),
        // Same rule: absent is an older app, not a pause.
        ...(body.sending_enabled === undefined ? {} : { sendingEnabled: body.sending_enabled }),

        pendingCommands: [],
      })
      .where(eq(devices.id, device.deviceId))

    /*
     * The account-scoped half, skipped when the phone has no number yet.
     *
     * Such a phone still beats -- that is how the dashboard learns its SIMs and
     * that it is alive -- but there is no account for it to be the heartbeat
     * *of*, and `notifier_events` hangs off an account.
     */
    if (device.receivingAccountId) {
      await tx
        .update(receivingAccounts)
        .set({ lastHeartbeatAt: now })
        .where(eq(receivingAccounts.id, device.receivingAccountId))
    }

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

    await recordLostPermissions(tx, device, body.permissions ?? null)

    return (current?.pending ?? []) as DeviceCommand[]
  })

  /*
   * Ride the beat rather than having the app poll for it.
   *
   * Capture settings change rarely and matter within minutes, not seconds, so a
   * separate endpoint the phone would have to remember to call is strictly worse
   * — it is one more thing that can be missed after an outage. The app applies
   * whatever comes back here, which also means a phone that has been offline
   * comes back in step without any reconciliation logic.
   */
  const capture = device.receivingAccountId
    ? await getCaptureSettings(device.receivingAccountId)
    : null

  return {
    status: 200,
    body: {
      ok: true,
      commands,
      capture,
      /*
       * Which merchant this credential is for, on every beat.
       *
       * The pair response has always carried it and the app threw it away, so a
       * phone helping two shops had no way to say which pairing belonged to
       * which — it could only list numbers. Sending it here as well as at
       * pairing means a phone that was already set up learns the name on its
       * next beat, rather than only after being paired again.
       */
      business: { id: device.businessId, name: device.businessName },
      server_time: now.toISOString(),
      request_id: context.requestId,
    },
  }
})
