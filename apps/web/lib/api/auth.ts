import { type BusinessStatus, isBusinessLive } from '@jomma/shared'
import { eq } from 'drizzle-orm'
import { apiKeyPrefix, bearerToken, deviceTokenPrefix, verifyCredential } from '@/lib/auth/tokens'
import { db } from '@/lib/db/client'
import { apiKeys, apps, businesses, devices, receivingAccounts } from '@/lib/db/schema'
import { ApiError } from './errors'
import { enforceRateLimit, type RequestContext } from './handler'

/**
 * Two independent credential families.
 *
 * A client app's API key and a phone's device token are never interchangeable: a
 * stolen phone cannot create intents, and a leaked API key cannot inject
 * captures. Both are Argon2-hashed; the clear-text prefix is only an index.
 */

export interface AuthenticatedApp {
  appId: string
  appName: string
  /**
   * The merchant this key belongs to.
   *
   * Carried on the authenticated principal rather than looked up per call, so
   * every handler already has it and none has to decide where to get it. That
   * is the point: tenancy that has to be fetched is tenancy somebody will
   * forget to fetch.
   */
  businessId: string
  /** A suspended or unapproved merchant cannot take money. */
  businessStatus: BusinessStatus
  apiKeyId: string
  environment: 'live' | 'test'
  /** Stable identity for rate limiting. */
  rateKey: string
}

export interface AuthenticatedDevice {
  deviceId: string
  deviceName: string
  /** The merchant this phone helps. Always present — a phone pairs to one. */
  businessId: string
  /**
   * The number it watches, or null before one has been chosen.
   *
   * Null is a phone that has paired and is reporting its SIMs with nothing
   * bound yet. Endpoints that need a number say so themselves rather than
   * relying on authentication to have refused it, because refusing there would
   * stop the phone reporting the very SIMs the choice is made from.
   */
  receivingAccountId: string | null
  provider: 'bkash' | 'nagad' | null
  msisdn: string | null
  rateKey: string
}

export async function authenticateApp(
  request: Request,
  context: RequestContext,
): Promise<AuthenticatedApp> {
  const token = bearerToken(request.headers.get('authorization'))
  if (!token?.startsWith('jm_')) throw ApiError.unauthorized()

  const row = await db
    .select({
      keyId: apiKeys.id,
      keyHash: apiKeys.keyHash,
      status: apiKeys.status,
      environment: apiKeys.environment,
      appId: apps.id,
      appName: apps.name,
      appStatus: apps.status,
      businessId: apps.businessId,
      businessStatus: businesses.status,
    })
    .from(apiKeys)
    .innerJoin(apps, eq(apiKeys.appId, apps.id))
    .innerJoin(businesses, eq(apps.businessId, businesses.id))
    .where(eq(apiKeys.prefix, apiKeyPrefix(token)))
    .limit(1)
    .then((rows) => rows[0])

  /*
   * An unknown prefix is refused here, before any hashing.
   *
   * This used to run Argon2 against a dummy hash first, so that "no such
   * prefix" and "wrong secret" took the same time and prefixes could not be
   * enumerated by timing. That defended nothing worth defending and paid for it
   * with a denial of service.
   *
   * Nothing worth defending, because a prefix is not a secret: it is stored in
   * clear, it is the first sixteen characters of a key whose remaining
   * twenty-four are the actual credential, and confirming one exists gets an
   * attacker no closer to guessing those. Enumerating the eight random
   * characters in it means 62^8 requests to learn something that does not help.
   *
   * And an expensive way to pay, because it made every unauthenticated request
   * cost an Argon2id verify -- 19 MiB and tens of milliseconds, by design --
   * before any rate limit had been consulted, since routes rate limit on the
   * authenticated principal and there isn't one yet. Measured on a dev machine:
   * ~34 ms per garbage key, and thirty concurrent more than doubled the latency
   * of an unrelated request. On a 512 MiB instance thirty of them is the whole
   * machine. `Bearer jm_live_anything`, repeated, was enough.
   */
  if (!row) throw ApiError.unauthorized()

  /*
   * Now there is a real, non-secret identifier to count against, so the cost of
   * verifying is bounded per key before it is paid. Someone who has seen a
   * key's first sixteen characters can still make us hash, but only sixty times
   * a minute for that one prefix, rather than without limit for any string
   * beginning "jm_".
   */
  enforceRateLimit(context, 'auth:verify', `key:${row.keyId}`)

  const valid = await verifyCredential(row.keyHash, token)
  if (!valid) throw ApiError.unauthorized()
  if (row.status !== 'active') throw ApiError.unauthorized('This key has been revoked.')
  if (row.appStatus !== 'active') throw ApiError.forbidden('This app is suspended.')

  /*
   * The approval gate, enforced at the credential rather than at the screen.
   * A merchant can hold a key before they are approved — they are given one at
   * setup so they can integrate — but it must not move money until a human has
   * looked at them. Checking here means every endpoint inherits the rule
   * instead of each one remembering it.
   */
  if (!isBusinessLive(row.businessStatus)) {
    throw ApiError.forbidden(
      row.businessStatus === 'pending'
        ? 'This business is awaiting approval and cannot take payments yet.'
        : 'This business is not currently able to take payments.',
    )
  }

  // Fire and forget: a failed last-used write must not fail the request.
  void db
    .update(apiKeys)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiKeys.id, row.keyId))
    .catch(() => {})

  return {
    appId: row.appId,
    appName: row.appName,
    businessId: row.businessId,
    businessStatus: row.businessStatus,
    apiKeyId: row.keyId,
    environment: row.environment,
    rateKey: row.keyId,
  }
}

/**
 * Device auth needs both the bearer token and a matching `X-Device-Id`. The
 * header alone proves nothing, but requiring it means a token replayed from a
 * different device id is rejected before it can write a capture.
 */
export async function authenticateDevice(
  request: Request,
  context: RequestContext,
): Promise<AuthenticatedDevice> {
  const token = bearerToken(request.headers.get('authorization'))
  const deviceId = request.headers.get('x-device-id')?.trim()

  if (!token?.startsWith('jmd_') || !deviceId) throw ApiError.unauthorized()

  const row = await db
    .select({
      deviceId: devices.id,
      deviceName: devices.name,
      tokenHash: devices.tokenHash,
      status: devices.status,
      businessId: devices.businessId,
      accountId: receivingAccounts.id,
      provider: receivingAccounts.provider,
      msisdn: receivingAccounts.msisdn,
      accountStatus: receivingAccounts.status,
    })
    .from(devices)
    /*
     * Left, not inner.
     *
     * A phone paired to a business with no number bound to it yet is a real and
     * necessary state — it has scanned the code and is reporting its SIMs so
     * that somebody can choose one. An inner join made that phone fail to
     * authenticate at all, which would have made the whole flow impossible: it
     * could not heartbeat, so it could never report the SIMs that the choosing
     * depends on.
     */
    .leftJoin(receivingAccounts, eq(devices.receivingAccountId, receivingAccounts.id))
    .where(eq(devices.tokenPrefix, deviceTokenPrefix(token)))
    .limit(1)
    .then((rows) => rows[0])

  /*
   * A `pending` device has no hash yet — it has a provisioning QR that nobody
   * has scanned. Treat it exactly like an unknown prefix: refused here, before
   * any hashing, for the reasons in `authenticateApp`. A device token prefix is
   * as public as an API key's and hashing on its behalf was a free way for
   * anyone to spend the server's memory.
   */
  if (!row?.tokenHash) throw ApiError.unauthorized()

  enforceRateLimit(context, 'auth:verify', `device:${row.deviceId}`)

  const valid = await verifyCredential(row.tokenHash, token)
  if (!valid) throw ApiError.unauthorized()
  if (row.deviceId !== deviceId) throw ApiError.unauthorized()
  // A revoked device must be re-provisioned by QR from the dashboard.
  /*
   * The pairing gate. A phone that has scanned a valid QR holds a real token
   * and still cannot do anything with it until someone at the dashboard says
   * that phone is theirs — see DEVICE_STATUSES.
   *
   * Told apart from a revocation because the two need opposite reactions: one
   * is "wait, someone is about to approve you", the other is "stop, and do not
   * come back". A phone that retried forever on a revoked token would be a
   * phone nobody could switch off.
   */
  if (row.status === 'awaiting_approval') {
    throw ApiError.forbidden('This phone is waiting to be approved on the dashboard.')
  }
  if (row.status !== 'active') throw ApiError.unauthorized('This device has been revoked.')

  return {
    deviceId: row.deviceId,
    deviceName: row.deviceName,
    businessId: row.businessId,
    receivingAccountId: row.accountId,
    provider: row.provider,
    msisdn: row.msisdn,
    rateKey: row.deviceId,
  }
}

/*
 * The dummy Argon2id hash that used to live here is gone.
 *
 * It existed to equalise the timing of "unknown prefix" and "wrong secret". A
 * prefix is stored in clear and is not a secret, so learning that one exists is
 * worth nothing without the twenty-four characters that follow it — and paying
 * for that with an unmetered Argon2 verify on every unauthenticated request was
 * a denial of service anyone could trigger. See `authenticateApp`.
 */
