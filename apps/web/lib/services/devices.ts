import 'server-only'

import { createHash, randomBytes } from 'node:crypto'
import type { DeviceStatus } from '@jomma/shared'
import { env } from '@jomma/shared/env'
import { and, desc, eq, gt, isNull, ne } from 'drizzle-orm'
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

/**
 * A code that pairs a phone to a business, with no number chosen yet.
 *
 * The way a phone is set up now. Somebody scans this, the phone reports the
 * SIMs it can see, and the numbers get chosen from that list afterwards — so
 * nobody types a bKash number into a form and hopes it matches the SIM the
 * messages will actually arrive on.
 *
 * The older per-account code below still exists for a phone being added to a
 * number that is already set up, which is a different and still-real job.
 */
export async function createPhoneProvisioning(options: {
  businessId: string
  name?: string | null
  actorId: string | null
}): Promise<{ deviceId: string; qrDataUrl: string; payload: ProvisioningPayload }> {
  return issueProvisioning({
    businessId: options.businessId,
    receivingAccountId: null,
    name: options.name,
    actorId: options.actorId,
  })
}

export async function createDeviceWithProvisioning(options: {
  receivingAccountId: string
  /**
   * Optional, and usually absent.
   *
   * The phone sends its own model when it pairs, which is a better name than
   * anything the person generating the QR could guess — they have not met the
   * device yet. Naming it here first was a required field standing between the
   * operator and the only thing this screen exists to produce.
   */
  name?: string | null
  actorId: string | null
  /**
   * The handset this code is being minted for, when there is exactly one.
   *
   * Set on the `add_account` path, where the code is queued as a command and
   * delivered over the heartbeat to one already-approved phone — so the row can
   * be bound to that handset before anybody redeems it, and approval inherited
   * rather than asked for a second time. See [claimProvisioning].
   */
  installId?: string | null
}): Promise<{ deviceId: string; qrDataUrl: string; payload: ProvisioningPayload }> {
  const account = await db.query.receivingAccounts.findFirst({
    where: eq(receivingAccounts.id, options.receivingAccountId),
  })
  if (!account) throw new Error('Unknown receiving account')

  return issueProvisioning({
    // Taken from the account rather than passed in: they must agree, and a
    // caller that could disagree is a caller that eventually will.
    businessId: account.businessId,
    receivingAccountId: account.id,
    name: options.name,
    actorId: options.actorId,
    installId: options.installId,
  })
}

/** The half both entry points share: mint a code, stage a device, draw the QR. */
async function issueProvisioning(options: {
  businessId: string
  receivingAccountId: string | null
  name?: string | null
  actorId: string | null
  installId?: string | null
}): Promise<{ deviceId: string; qrDataUrl: string; payload: ProvisioningPayload }> {
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
      businessId: options.businessId,
      receivingAccountId: options.receivingAccountId,
      // Left to the column default when absent — the phone names itself on
      // pairing, which is later than this and better informed.
      ...(options.name?.trim() ? { name: options.name.trim() } : {}),
      platform: 'android',
      status: 'pending',
      /*
       * Pre-bound, on the one path that knows which handset will redeem this.
       *
       * Null for a QR on a dashboard, which is shown to a room and could be
       * scanned by anyone -- that one has to be approved. See [claimProvisioning].
       */
      ...(options.installId ? { installId: options.installId } : {}),
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
      payload: {
        device_id: device.id,
        business_id: options.businessId,
        account_id: options.receivingAccountId,
        stage: 'qr_issued',
      },
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
export async function claimPairingCode(options: {
  code: string
  ip: string | null
  /** What the phone calls itself. Cosmetic — see `devices.name`. */
  deviceName?: string
  /** Which handset it is. Not cosmetic — see `devices.installId`. */
  installId?: string
}): Promise<{
  deviceToken: string
  deviceId: string
  /**
   * Which merchant this phone now helps.
   *
   * Always present — a phone pairs to a business, and that is the thing the app
   * shows and switches between. The account below is the optional half.
   */
  business: { id: string; name: string }
  /** False when this handset was already approved here — see [claimProvisioning]. */
  awaitingApproval: boolean
  /** Null when the phone paired to a business that has no number bound yet. */
  account: { msisdn: string; provider: string } | null
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
    deviceName: options.deviceName,
    installId: options.installId,
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
  deviceName?: string
  installId?: string
}): Promise<{
  deviceToken: string
  deviceId: string
  /**
   * Which merchant this phone now helps.
   *
   * Always present — a phone pairs to a business, and that is the thing the app
   * shows and switches between. The account below is the optional half.
   */
  business: { id: string; name: string }
  /** False when this handset was already approved here — see [claimProvisioning]. */
  awaitingApproval: boolean
  /** Null when the phone paired to a business that has no number bound yet. */
  account: { msisdn: string; provider: string } | null
}> {
  const device = await db.query.devices.findFirst({
    where: and(
      eq(devices.id, options.deviceId),
      eq(devices.status, 'pending'),
      gt(devices.provisioningExpiresAt, new Date()),
    ),
    with: { account: true, business: true },
  })

  if (!device?.provisioningHash) throw new Error('provisioning_invalid')

  const valid = await verifyCredential(device.provisioningHash, options.provisioningToken)
  if (!valid) throw new Error('provisioning_invalid')

  const issued = await generateDeviceToken()

  /*
   * Approval is about the handset, not about each number on it.
   *
   * Choosing a SIM mints a *second* device row -- one credential per number, so
   * revoking one leaves the others reporting -- and that row was landing
   * `awaiting_approval` like any other. So approving a phone, then picking its
   * bKash number, threw the same handset back into the approval queue: the
   * operator approved the phone in their hand, and the phone immediately said
   * it was waiting for approval again. Nobody had changed their mind about it.
   *
   * Inherited only when all three hold:
   *
   *   - the row was bound to a handset when it was minted, which only
   *     `addAccountFromSim` does, and only for a phone already helping this
   *     business;
   *   - the phone redeeming it reports that same handset;
   *   - that handset already has an approved device here.
   *
   * A QR shown on a dashboard is unbound, so it still needs approving however
   * many times it is scanned -- which is the case approval exists for, since
   * that code is a bearer credential that gets screenshotted and forwarded. The
   * `add_account` code is never shown to anyone: it is queued as a command and
   * delivered over the heartbeat, so reading it already means holding the
   * device token it was sent to.
   */
  const boundTo = device.installId
  const inheritsApproval =
    boundTo !== null && boundTo === options.installId
      ? (
          await db
            .select({ id: devices.id })
            .from(devices)
            .where(
              and(
                eq(devices.businessId, device.businessId),
                eq(devices.installId, boundTo),
                eq(devices.status, 'active'),
              ),
            )
            .limit(1)
        ).length > 0
      : false

  await db.transaction(async (tx) => {
    // Conditional on still being `pending`: two phones scanning the same QR must
    // not both end up holding a valid token.
    const [claimed] = await tx
      .update(devices)
      .set({
        tokenPrefix: issued.prefix,
        tokenHash: issued.hash,
        /*
         * Not `active`, unless this handset is already approved here. Scanning
         * proves someone holds the code; it does not prove they are the
         * operator, so the token is inert until the dashboard approves this
         * phone — see DEVICE_STATUSES.
         */
        status: inheritsApproval ? 'active' : 'awaiting_approval',
        provisioningHash: null,
        // Cleared together. Leaving the lookup behind would keep a burned code
        // resolving to a row, and the unique index would then reject the next
        // QR issued for this device.
        pairingLookup: null,
        provisioningExpiresAt: null,
        provisionedAt: new Date(),
        tokenIssuedAt: new Date(),
        lastSeenIp: options.ip,
        // Only when the phone offered one, so a rename from the dashboard is
        // not undone by the next thing the device says about itself.
        ...(options.deviceName ? { name: options.deviceName } : {}),
        ...(options.installId ? { installId: options.installId } : {}),
      })
      .where(and(eq(devices.id, options.deviceId), eq(devices.status, 'pending')))
      .returning({ id: devices.id })

    if (!claimed) throw new Error('provisioning_invalid')

    /*
     * One waiting record per handset, not one per attempt.
     *
     * Every "Show pairing code" mints a device row and every scan turns one
     * into `awaiting_approval`, so somebody who pressed it a few times — a code
     * expired, or the first scan did not seem to do anything — ended up with
     * the same phone listed six times, each with its own approve and decline,
     * and nothing saying which was live.
     *
     * Keyed on `installId` rather than on the name. Names are cosmetic and two
     * phones can share one, so matching on them would retire a different
     * handset that happened to be called the same thing.
     *
     * Only rows with no account are retired. A phone legitimately holds one
     * credential per number it watches; those are not duplicates, and revoking
     * them would stop it reporting for numbers it is already live on.
     */
    if (options.installId) {
      await tx
        .update(devices)
        .set({ status: 'revoked', revokedAt: new Date(), tokenHash: null, tokenPrefix: null })
        .where(
          and(
            eq(devices.businessId, device.businessId),
            eq(devices.installId, options.installId),
            eq(devices.status, 'awaiting_approval'),
            isNull(devices.receivingAccountId),
            ne(devices.id, device.id),
          ),
        )
    }

    // Only when somebody actually has to do something. An inherited approval
    // is not a decision waiting on a human, and raising the attention badge for
    // it would train people to ignore the badge.
    if (!inheritsApproval) {
      await tx.insert(notifierEvents).values({
        receivingAccountId: device.receivingAccountId,
        deviceId: device.id,
        kind: 'service_restarted',
        // Medium, not low: this is a decision waiting on a human, and it is the
        // signal the accounts screen raises its attention badge from.
        severity: 'medium',
        detail: 'A phone scanned the pairing code and is waiting for approval',
      })
    }

    await audit(tx, {
      action: 'device.provisioned',
      actorType: 'device',
      // Recorded either way, and distinguishable: a device that became active
      // without anybody pressing Approve should say so in the trail.
      payload: {
        device_id: device.id,
        stage: inheritsApproval ? 'approval_inherited' : 'awaiting_approval',
        ...(inheritsApproval ? { inherited_from_install: boundTo } : {}),
      },
    })
  })

  return {
    deviceToken: issued.plaintext,
    deviceId: device.id,
    /*
     * Told, rather than assumed.
     *
     * The app used to hardcode "waiting" for every pairing it created, so a
     * credential that was live on arrival still showed as waiting until a
     * heartbeat corrected it.
     */
    awaitingApproval: !inheritsApproval,
    business: { id: device.business.id, name: device.business.name },
    /*
     * Null for a phone paired to a business with nothing bound to it yet — it
     * has scanned the code and is reporting its SIMs, waiting for somebody to
     * choose one. The app reads this as "paired, no number yet" rather than as
     * a failure.
     */
    account: device.account
      ? { msisdn: device.account.msisdn, provider: device.account.provider }
      : null,
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

/**
 * Renaming a phone.
 *
 * Free-form and non-unique on purpose — see `devices.name`. Two phones with the
 * same name in one account is allowed, because the alternative is a rename that
 * fails for a reason the operator cannot see and does not care about.
 */
export async function renameDevice(options: {
  deviceId: string
  name: string
  actorId: string
}): Promise<void> {
  const name = options.name.trim()
  if (!name) throw new Error('Give the phone a name.')
  if (name.length > 60) throw new Error('That name is too long.')

  const [device] = await db
    .update(devices)
    .set({ name })
    .where(eq(devices.id, options.deviceId))
    .returning({ id: devices.id })

  if (!device) throw new Error('Unknown device')

  await audit(db, {
    action: 'device.provisioned',
    actorId: options.actorId,
    actorType: 'admin',
    payload: { device_id: options.deviceId, stage: 'renamed', name },
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
