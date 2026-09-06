import { type BusinessStatus, isBusinessLive } from '@jomma/shared'
import { eq } from 'drizzle-orm'
import { apiKeyPrefix, bearerToken, deviceTokenPrefix, verifyCredential } from '@/lib/auth/tokens'
import { db } from '@/lib/db/client'
import { apiKeys, apps, businesses, devices, receivingAccounts } from '@/lib/db/schema'
import { ApiError } from './errors'

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
  receivingAccountId: string
  provider: 'bkash' | 'nagad'
  msisdn: string
  rateKey: string
}

export async function authenticateApp(request: Request): Promise<AuthenticatedApp> {
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

  // Same error for "no such prefix" and "wrong secret" — a caller must not be
  // able to enumerate valid prefixes by watching which one takes longer.
  if (!row) {
    await verifyCredential(DUMMY_HASH, token)
    throw ApiError.unauthorized()
  }

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
export async function authenticateDevice(request: Request): Promise<AuthenticatedDevice> {
  const token = bearerToken(request.headers.get('authorization'))
  const deviceId = request.headers.get('x-device-id')?.trim()

  if (!token?.startsWith('jmd_') || !deviceId) throw ApiError.unauthorized()

  const row = await db
    .select({
      deviceId: devices.id,
      deviceName: devices.name,
      tokenHash: devices.tokenHash,
      status: devices.status,
      accountId: receivingAccounts.id,
      provider: receivingAccounts.provider,
      msisdn: receivingAccounts.msisdn,
      accountStatus: receivingAccounts.status,
    })
    .from(devices)
    .innerJoin(receivingAccounts, eq(devices.receivingAccountId, receivingAccounts.id))
    .where(eq(devices.tokenPrefix, deviceTokenPrefix(token)))
    .limit(1)
    .then((rows) => rows[0])

  // A `pending` device has no hash yet — it has a provisioning QR that nobody
  // has scanned. Treat it exactly like an unknown prefix.
  if (!row?.tokenHash) {
    await verifyCredential(DUMMY_HASH, token)
    throw ApiError.unauthorized()
  }

  const valid = await verifyCredential(row.tokenHash, token)
  if (!valid) throw ApiError.unauthorized()
  if (row.deviceId !== deviceId) throw ApiError.unauthorized()
  // A revoked device must be re-provisioned by QR from the dashboard.
  if (row.status !== 'active') throw ApiError.unauthorized('This device has been revoked.')

  return {
    deviceId: row.deviceId,
    deviceName: row.deviceName,
    receivingAccountId: row.accountId,
    provider: row.provider,
    msisdn: row.msisdn,
    rateKey: row.deviceId,
  }
}

/**
 * A real Argon2id hash of a value nothing will ever present. Verifying against
 * it on the miss path keeps the timing of "unknown prefix" and "wrong secret"
 * roughly equal.
 */
const DUMMY_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHR2YWx1ZXg$8Z3EJdKQ5oCw9wIrLpQ8nHRk1lPHfEqXvJmZ0mQ3Vzg'
