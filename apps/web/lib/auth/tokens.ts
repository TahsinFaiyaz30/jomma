import { randomBytes, timingSafeEqual } from 'node:crypto'
import type { KeyEnvironment } from '@jomma/shared'
import { hash, verify } from '@node-rs/argon2'

/**
 * Credential generation and verification.
 *
 * API keys and device tokens are Argon2id-hashed at rest, exactly like a
 * password. The plaintext is returned once at creation and never stored.
 *
 * The `prefix` is stored in clear and uniquely indexed. Without it, verifying a
 * request would mean an Argon2 comparison against every key in the table, which
 * is both slow by design and unbounded.
 */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'

/** Rejection sampling — modulo on random bytes would bias the alphabet. */
function randomString(length: number): string {
  const out: string[] = []
  while (out.length < length) {
    for (const byte of randomBytes(length * 2)) {
      if (byte < 248) {
        out.push(ALPHABET[byte % ALPHABET.length] as string)
        if (out.length === length) break
      }
    }
  }
  return out.join('')
}

/**
 * OWASP's Argon2id baseline: 19 MiB, 2 iterations, 1 lane.
 *
 * `algorithm` is left at the library default, which is Argon2id — the enum is an
 * ambient const enum and cannot be referenced under `verbatimModuleSyntax`.
 */
const ARGON2_OPTIONS = {
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const

export const API_KEY_PREFIX_LENGTH = 16
export const DEVICE_TOKEN_PREFIX_LENGTH = 12

export interface GeneratedCredential {
  /** Shown to the operator exactly once. */
  plaintext: string
  /** Stored in clear, uniquely indexed, used to find the row before verifying. */
  prefix: string
  lastFour: string
  hash: string
}

/** `jm_live_` + 32 characters. */
export async function generateApiKey(
  environment: KeyEnvironment = 'live',
): Promise<GeneratedCredential> {
  const plaintext = `jm_${environment}_${randomString(32)}`
  return {
    plaintext,
    prefix: plaintext.slice(0, API_KEY_PREFIX_LENGTH),
    lastFour: plaintext.slice(-4),
    hash: await hash(plaintext, ARGON2_OPTIONS),
  }
}

/** `jmd_` + 32 characters. Scoped to one receiving account, revocable alone. */
export async function generateDeviceToken(): Promise<GeneratedCredential> {
  const plaintext = `jmd_${randomString(32)}`
  return {
    plaintext,
    prefix: plaintext.slice(0, DEVICE_TOKEN_PREFIX_LENGTH),
    lastFour: plaintext.slice(-4),
    hash: await hash(plaintext, ARGON2_OPTIONS),
  }
}

export function apiKeyPrefix(plaintext: string): string {
  return plaintext.slice(0, API_KEY_PREFIX_LENGTH)
}

export function deviceTokenPrefix(plaintext: string): string {
  return plaintext.slice(0, DEVICE_TOKEN_PREFIX_LENGTH)
}

/** Argon2 verification. Returns false rather than throwing on a malformed hash. */
export async function verifyCredential(storedHash: string, plaintext: string): Promise<boolean> {
  try {
    return await verify(storedHash, plaintext, ARGON2_OPTIONS)
  } catch {
    return false
  }
}

/** Extracts a bearer token, tolerating case and extra whitespace. */
export function bearerToken(header: string | null | undefined): string | null {
  if (!header) return null
  const match = /^bearer\s+(.+)$/i.exec(header.trim())
  return match?.[1]?.trim() || null
}

/** Constant-time string comparison for signatures and shared secrets. */
export function constantTimeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8')
  const right = Buffer.from(b, 'utf8')
  if (left.length !== right.length) {
    // Still burn a comparison so length is not leaked by timing.
    timingSafeEqual(left, left)
    return false
  }
  return timingSafeEqual(left, right)
}
