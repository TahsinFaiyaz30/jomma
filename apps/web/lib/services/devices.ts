import 'server-only'

import { randomBytes } from 'node:crypto'
import { env } from '@jomma/shared/env'
import { and, desc, eq, gt } from 'drizzle-orm'
import QRCode from 'qrcode'
import { generateDeviceToken, verifyCredential } from '@/lib/auth/tokens'
import { db } from '@/lib/db/client'
import { devices, notifierEvents, receivingAccounts } from '@/lib/db/schema'
import { audit } from './audit'
import { secondsFromNow } from './time'

/**
 * Device provisioning, per docs/android.md.
 *
 *   1. Dashboard mints a pending device and shows a QR.
 *   2. The app scans it and exchanges the one-time token for a long-lived one.
 *   3. The one-time value is burned; the device goes active.
 *
 * The provisioning token is hashed at rest like every other credential. A QR
 * screenshot left in a chat should not be a way into the capture endpoint, and
 * it expires quickly regardless.
 */

/** Long enough to walk a phone over and scan it, short enough to be useless later. */
export const PROVISIONING_TTL_SECONDS = 15 * 60

export interface ProvisioningPayload {
  /** Where the app should POST. */
  url: string
  token: string
  device_id: string
  account: { msisdn: string; provider: string; label: string }
  expires_at: string
}

export async function createDeviceWithProvisioning(options: {
  receivingAccountId: string
  name: string
  actorId: string
}): Promise<{ deviceId: string; qrDataUrl: string; payload: ProvisioningPayload }> {
  const account = await db.query.receivingAccounts.findFirst({
    where: eq(receivingAccounts.id, options.receivingAccountId),
  })
  if (!account) throw new Error('Unknown receiving account')

  // Not a device token — a short-lived bearer for one exchange only.
  const plaintext = `jmp_${randomBytes(24).toString('base64url')}`
  const hash = await hashProvisioning(plaintext)
  const expiresAt = secondsFromNow(PROVISIONING_TTL_SECONDS)

  const [device] = await db
    .insert(devices)
    .values({
      receivingAccountId: options.receivingAccountId,
      name: options.name,
      platform: 'android',
      status: 'pending',
      provisioningHash: hash,
      provisioningExpiresAt: expiresAt,
    })
    .returning()
  if (!device) throw new Error('Failed to create device')

  await db.transaction(async (tx) => {
    await audit(tx, {
      action: 'device.provisioned',
      actorId: options.actorId,
      actorType: 'admin',
      payload: { device_id: device.id, account_id: account.id, stage: 'qr_issued' },
    })
  })

  const payload: ProvisioningPayload = {
    url: env().APP_URL,
    token: plaintext,
    device_id: device.id,
    account: { msisdn: account.msisdn, provider: account.provider, label: account.label },
    expires_at: expiresAt.toISOString(),
  }

  const qrDataUrl = await QRCode.toDataURL(JSON.stringify(payload), {
    errorCorrectionLevel: 'M',
    margin: 1,
    width: 320,
  })

  return { deviceId: device.id, qrDataUrl, payload }
}

/**
 * The exchange. Called by the app, unauthenticated except for the one-time
 * token itself — the device has no credential yet, which is the whole point.
 */
export async function claimProvisioning(options: {
  deviceId: string
  provisioningToken: string
  ip: string | null
}): Promise<{
  deviceToken: string
  deviceId: string
  account: { msisdn: string; provider: string }
}> {
  const device = await db.query.devices.findFirst({
    where: and(
      eq(devices.id, options.deviceId),
      eq(devices.status, 'pending'),
      gt(devices.provisioningExpiresAt, new Date()),
    ),
    with: { account: true },
  })

  if (!device?.provisioningHash) throw new Error('provisioning_invalid')

  const valid = await verifyCredential(device.provisioningHash, options.provisioningToken)
  if (!valid) throw new Error('provisioning_invalid')

  const issued = await generateDeviceToken()

  await db.transaction(async (tx) => {
    // Conditional on still being `pending`: two phones scanning the same QR must
    // not both end up holding a valid token.
    const [claimed] = await tx
      .update(devices)
      .set({
        tokenPrefix: issued.prefix,
        tokenHash: issued.hash,
        status: 'active',
        provisioningHash: null,
        provisioningExpiresAt: null,
        provisionedAt: new Date(),
        tokenIssuedAt: new Date(),
        lastSeenIp: options.ip,
      })
      .where(and(eq(devices.id, options.deviceId), eq(devices.status, 'pending')))
      .returning({ id: devices.id })

    if (!claimed) throw new Error('provisioning_invalid')

    await tx.insert(notifierEvents).values({
      receivingAccountId: device.receivingAccountId,
      deviceId: device.id,
      kind: 'service_restarted',
      severity: 'low',
      detail: 'Device provisioned',
    })

    await audit(tx, {
      action: 'device.provisioned',
      actorType: 'device',
      payload: { device_id: device.id, stage: 'claimed' },
    })
  })

  return {
    deviceToken: issued.plaintext,
    deviceId: device.id,
    account: { msisdn: device.account.msisdn, provider: device.account.provider },
  }
}

/**
 * Asks a device to rotate its token.
 *
 * This queues the command and changes nothing else. The swap is device-initiated
 * (`POST /device/v1/rotate`) for a reason: the new plaintext can only be handed
 * to whoever is holding the current token, and issuing it here would mean either
 * storing a plaintext token so the device could collect it later, or cutting the
 * device off the moment an admin clicked a button.
 *
 * So the old token stays valid until the device actually swaps. If the rotation
 * is because something leaked, revoke instead — that is immediate.
 */
export async function requestTokenRotation(options: {
  deviceId: string
  actorId: string
}): Promise<void> {
  await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(devices)
      .set({ pendingCommands: [{ type: 'rotate_token' }] })
      .where(and(eq(devices.id, options.deviceId), eq(devices.status, 'active')))
      .returning({ id: devices.id })

    if (!updated) throw new Error('That device is not active.')

    await audit(tx, {
      action: 'device.provisioned',
      actorId: options.actorId,
      actorType: 'admin',
      payload: { device_id: options.deviceId, stage: 'rotation_requested' },
    })
  })
}

/**
 * The swap itself, called by the device with its current (still valid) token.
 *
 * Conditional on the current prefix so a replayed rotation cannot mint a second
 * token: whichever request arrives first wins, and the second finds the prefix
 * already changed.
 */
export async function completeTokenRotation(options: {
  deviceId: string
  currentPrefix: string
}): Promise<{ deviceToken: string }> {
  const issued = await generateDeviceToken()

  await db.transaction(async (tx) => {
    const [rotated] = await tx
      .update(devices)
      .set({
        tokenPrefix: issued.prefix,
        tokenHash: issued.hash,
        tokenIssuedAt: new Date(),
        pendingCommands: [],
      })
      .where(
        and(
          eq(devices.id, options.deviceId),
          eq(devices.status, 'active'),
          eq(devices.tokenPrefix, options.currentPrefix),
        ),
      )
      .returning({ id: devices.id })

    if (!rotated) throw new Error('rotation_conflict')

    await audit(tx, {
      action: 'device.provisioned',
      actorType: 'device',
      payload: { device_id: options.deviceId, stage: 'rotated' },
    })
  })

  return { deviceToken: issued.plaintext }
}

/** Revocation is immediate. The device gets 401 and must be re-provisioned. */
export async function revokeDevice(options: { deviceId: string; actorId: string }): Promise<void> {
  await db.transaction(async (tx) => {
    const [device] = await tx
      .update(devices)
      .set({
        status: 'revoked',
        revokedAt: new Date(),
        // Clearing the hash means even a replayed token cannot verify.
        tokenHash: null,
        tokenPrefix: null,
        pendingCommands: [{ type: 'stop' }],
      })
      .where(eq(devices.id, options.deviceId))
      .returning()

    if (!device) throw new Error('Unknown device')

    await tx.insert(notifierEvents).values({
      receivingAccountId: device.receivingAccountId,
      deviceId: device.id,
      kind: 'error',
      severity: 'high',
      detail: 'Device revoked from the dashboard',
    })

    await audit(tx, {
      action: 'device.revoked',
      actorId: options.actorId,
      actorType: 'admin',
      payload: { device_id: options.deviceId },
    })
  })
}

export interface DeviceRow {
  id: string
  name: string
  status: 'pending' | 'active' | 'revoked'
  platform: string
  appVersion: string | null
  lastHeartbeatAt: string | null
  lastCaptureAt: string | null
  battery: number | null
  charging: boolean | null
  network: string | null
  queueDepth: number | null
  permissions: Record<string, boolean> | null
  tokenIssuedAt: string | null
  provisioningExpiresAt: string | null
  createdAt: string
}

export async function listDevices(receivingAccountId: string): Promise<DeviceRow[]> {
  const rows = await db
    .select()
    .from(devices)
    .where(eq(devices.receivingAccountId, receivingAccountId))
    .orderBy(desc(devices.createdAt))

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    status: row.status,
    platform: row.platform,
    appVersion: row.appVersion,
    lastHeartbeatAt: row.lastHeartbeatAt?.toISOString() ?? null,
    lastCaptureAt: row.lastCaptureAt?.toISOString() ?? null,
    battery: row.battery,
    charging: row.charging,
    network: row.network,
    queueDepth: row.queueDepth,
    permissions: row.permissions,
    tokenIssuedAt: row.tokenIssuedAt?.toISOString() ?? null,
    provisioningExpiresAt: row.provisioningExpiresAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  }))
}

async function hashProvisioning(plaintext: string): Promise<string> {
  const { hash } = await import('@node-rs/argon2')
  return hash(plaintext, { memoryCost: 19_456, timeCost: 2, parallelism: 1 })
}
