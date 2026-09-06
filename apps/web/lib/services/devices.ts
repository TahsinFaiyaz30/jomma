import 'server-only'

import { createHash, randomBytes } from 'node:crypto'
import type { DeviceStatus } from '@jomma/shared'
import { env } from '@jomma/shared/env'
import { and, desc, eq, gt, isNull } from 'drizzle-orm'
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
 *   2. The app reads it and exchanges the one-time code for a long-lived token.
 *   3. The one-time value is burned; the device goes active.
 *
 * ── Why the QR is a bare URL ──────────────────────────────────────────────────
 *
 * It used to be JSON: `{"url":…,"token":"jmp_…","device_id":…,"account":{…}}`.
 * That had two problems, and they pull in opposite directions.
 *
 * A general-purpose QR scanner — the camera app, any of the dozens of scanner
 * apps — cannot do anything with JSON except display it. So the only way in was
 * the notifier app's own scanner, and pointing the wrong scanner at the code
 * showed the operator a wall of JSON with a live credential and the account's
 * phone number sitting in it.
 *
 * A URL fixes both at once:
 *
 *   - **Any** scanner offers to open it, and Android App Links routes it
 *     straight into this app with no chooser and no browser, because the domain
 *     vouches for the app's signing certificate in `/.well-known/assetlinks.json`.
 *     Since Android 12 an app cannot claim a verified domain it does not own, so
 *     "no other app can process it" is enforced by the OS rather than hoped for.
 *   - A scanner that displays the target now shows a URL. The host, and an
 *     opaque code. No token, no msisdn, no account label.
 *
 * The code is still a bearer credential — anyone holding it can redeem it once,
 * within fifteen minutes — so this is not a claim that a leaked QR is harmless.
 * It is narrower than that: nothing *legible* leaks, and the payload is useless
 * without this server.
 */

/** Long enough to walk a phone over and scan it, short enough to be useless later. */
export const PROVISIONING_TTL_SECONDS = 15 * 60

export interface ProvisioningPayload {
  /** The whole QR. `https://<host>/pair/<code>`. */
  pair_url: string
  device_id: string
  expires_at: string
}

/**
 * The URL a scanner sees.
 *
 * Path segment rather than a query parameter, deliberately. Query strings end up
 * in browser history, in `Referer` headers and in access logs far more readily
 * than paths do, and this one is a credential.
 */
export function pairUrl(code: string, origin: string = env().APP_URL): string {
  return `${origin.replace(/\/+$/, '')}/pair/${code}`
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

  /*
   * 32 bytes, url-safe, no prefix.
   *
   * Unprefixed because this one travels in a URL that strangers' scanner apps
   * will render: `jmp_` announced "this is a credential" to anyone who glanced
   * at it. The entropy is what protects it, and 256 bits of it means the
   * sha256 lookup below has nothing to grind against.
   */
  const plaintext = randomBytes(32).toString('base64url')
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
      pairingLookup: pairingLookup(plaintext),
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
    pair_url: pairUrl(plaintext),
    device_id: device.id,
    expires_at: expiresAt.toISOString(),
  }

  const qrDataUrl = await QRCode.toDataURL(payload.pair_url, {
    /*
     * Q, up from M. The code is read off a laptop screen by a phone camera at
     * an angle, and a URL is a shorter payload than the old JSON, so the extra
     * redundancy is close to free — the symbol stays about the same size while
     * tolerating a good deal more glare and skew.
     */
    errorCorrectionLevel: 'Q',
    margin: 1,
    width: 320,
  })

  return { deviceId: device.id, qrDataUrl, payload }
}

/**
 * Redeems a pairing code — the App Links path, and now the scanner path too.
 *
 * Unauthenticated by necessity: the device has no credential yet, and the code
 * is the credential. Everything that makes that safe is here — single row,
 * verified hash, conditional burn, short TTL — plus IP rate limiting at the
 * route.
 */
export async function claimPairingCode(options: { code: string; ip: string | null }): Promise<{
  deviceToken: string
  deviceId: string
  account: { msisdn: string; provider: string }
}> {
  const device = await db.query.devices.findFirst({
    where: and(
      eq(devices.pairingLookup, pairingLookup(options.code)),
      eq(devices.status, 'pending'),
      gt(devices.provisioningExpiresAt, new Date()),
    ),
  })

  if (!device) throw new Error('provisioning_invalid')

  return claimProvisioning({
    deviceId: device.id,
    provisioningToken: options.code,
    ip: options.ip,
  })
}

/**
 * Whether a code could still be redeemed, without redeeming it.
 *
 * The `/pair/<code>` web page needs this — someone landed there in a browser,
 * which means the app is not installed — and it must not consume the code on
 * the way to saying so. Returns a bare boolean for the same reason the
 * provisioning route returns one error for every failure: "expired" and "wrong"
 * are not distinctions worth handing out.
 */
export async function isPairingCodeLive(code: string): Promise<boolean> {
  const device = await db.query.devices.findFirst({
    columns: { id: true },
    where: and(
      eq(devices.pairingLookup, pairingLookup(code)),
      eq(devices.status, 'pending'),
      gt(devices.provisioningExpiresAt, new Date()),
    ),
  })
  return device !== undefined
}

/** Finds the row. `provisioning_hash` is what actually verifies the code. */
function pairingLookup(code: string): string {
  return createHash('sha256').update(code).digest('hex')
}

/**
 * The exchange itself, once a code has been resolved to a device.
 *
 * Internal now — `claimPairingCode` is the only caller, because the QR no
 * longer carries a device id for anything to pass in. Kept separate from the
 * lookup so the burn stays one transaction with one conditional update.
 */
async function claimProvisioning(options: {
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
        /*
         * Not `active`. Scanning proves someone holds the code; it does not
         * prove they are the operator. The token is inert until the dashboard
         * approves this phone — see DEVICE_STATUSES.
         */
        status: 'awaiting_approval',
        provisioningHash: null,
        // Cleared together. Leaving the lookup behind would keep a burned code
        // resolving to a row, and the unique index would then reject the next
        // QR issued for this device.
        pairingLookup: null,
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
      // Medium, not low: this is a decision waiting on a human, and it is the
      // signal the accounts screen raises its attention badge from.
      severity: 'medium',
      detail: 'A phone scanned the pairing code and is waiting for approval',
    })

    await audit(tx, {
      action: 'device.provisioned',
      actorType: 'device',
      payload: { device_id: device.id, stage: 'awaiting_approval' },
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
/**
 * Approving a phone that has scanned the code.
 *
 * The second half of pairing. Scanning proves somebody holds a QR, which is a
 * bearer credential that gets screenshotted and forwarded; this proves the
 * operator recognises the phone. Only after both is the token it was issued
 * worth anything.
 *
 * Conditional on still being `awaiting_approval`, so approving twice — two
 * people looking at the same alert, or a double-click — cannot resurrect a
 * phone that was revoked in between.
 */
export async function approveDevice(options: { deviceId: string; actorId: string }): Promise<void> {
  await db.transaction(async (tx) => {
    const [device] = await tx
      .update(devices)
      .set({ status: 'active', provisionedAt: new Date() })
      .where(and(eq(devices.id, options.deviceId), eq(devices.status, 'awaiting_approval')))
      .returning()

    if (!device) throw new Error('That phone is not waiting for approval.')

    // Acknowledges the alert that raised the attention badge, so approving is
    // one action rather than two.
    await tx
      .update(notifierEvents)
      .set({ acknowledgedAt: new Date(), acknowledgedBy: options.actorId })
      .where(and(eq(notifierEvents.deviceId, device.id), isNull(notifierEvents.acknowledgedAt)))

    await tx.insert(notifierEvents).values({
      receivingAccountId: device.receivingAccountId,
      deviceId: device.id,
      kind: 'service_restarted',
      severity: 'low',
      detail: 'Phone approved and now capturing',
    })

    await audit(tx, {
      action: 'device.provisioned',
      actorId: options.actorId,
      actorType: 'admin',
      payload: { device_id: device.id, stage: 'approved' },
    })
  })
}

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
  status: DeviceStatus
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
