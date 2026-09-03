/**
 * Public IDs.
 *
 * Postgres 18 generates `uuidv7()` primary keys. UUIDv7 and ULID share the same
 * layout — 48-bit big-endian millisecond timestamp, then randomness — so a v7
 * UUID rendered in Crockford base32 is a valid, sortable 26-character ULID
 * string. That is exactly the shape docs/api.md shows (`int_01J8X...`).
 *
 * The database keeps the canonical uuid. The API only ever speaks the prefixed
 * form, so an internal id never leaks and a caller can tell an intent from an
 * event by looking at it.
 */

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

const DECODE: Record<string, number> = {}
for (let i = 0; i < CROCKFORD.length; i++) {
  const char = CROCKFORD[i] as string
  DECODE[char] = i
  DECODE[char.toLowerCase()] = i
}
// Crockford's documented ambiguity folding.
DECODE.O = 0
DECODE.o = 0
DECODE.I = 1
DECODE.i = 1
DECODE.L = 1
DECODE.l = 1

export const ID_PREFIXES = {
  intent: 'int',
  payment: 'pay',
  submission: 'sub',
  event: 'evt',
  request: 'req',
  app: 'app',
  key: 'key',
  device: 'dev',
  account: 'acct',
  endpoint: 'whe',
  delivery: 'whd',
  lock: 'lock',
  ref: 'ref',
} as const

export type IdKind = keyof typeof ID_PREFIXES
export type PrefixedId<K extends IdKind = IdKind> = `${(typeof ID_PREFIXES)[K]}_${string}`

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function uuidToBytes(uuid: string): Uint8Array {
  const hex = uuid.replace(/-/g, '')
  const out = new Uint8Array(16)
  for (let i = 0; i < 16; i++) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return out
}

function bytesToUuid(bytes: Uint8Array): string {
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function toBase32(bytes: Uint8Array): string {
  let value = 0n
  for (const byte of bytes) value = (value << 8n) | BigInt(byte)
  let out = ''
  for (let i = 0; i < 26; i++) {
    out = CROCKFORD[Number(value & 31n)] + out
    value >>= 5n
  }
  return out
}

function fromBase32(text: string): Uint8Array {
  let value = 0n
  for (const char of text) {
    const digit = DECODE[char]
    if (digit === undefined) throw new Error(`Invalid character in id: ${char}`)
    value = (value << 5n) | BigInt(digit)
  }
  const out = new Uint8Array(16)
  for (let i = 15; i >= 0; i--) {
    out[i] = Number(value & 0xffn)
    value >>= 8n
  }
  return out
}

/** `2b1f8e0a-...` + `intent` -> `int_01J8XR4M9K...` */
export function toPublicId<K extends IdKind>(kind: K, uuid: string): PrefixedId<K> {
  if (!UUID_RE.test(uuid)) throw new Error(`Not a uuid: ${uuid}`)
  return `${ID_PREFIXES[kind]}_${toBase32(uuidToBytes(uuid))}` as PrefixedId<K>
}

/**
 * Inverse of `toPublicId`. Returns null rather than throwing on anything
 * malformed — this parses untrusted path segments, where a bad id is a 404, not
 * a 500.
 */
export function fromPublicId<K extends IdKind>(kind: K, id: string): string | null {
  const prefix = `${ID_PREFIXES[kind]}_`
  if (!id.startsWith(prefix)) return null
  const body = id.slice(prefix.length)
  if (body.length !== 26) return null
  try {
    return bytesToUuid(fromBase32(body))
  } catch {
    return null
  }
}

/** Extracts the embedded millisecond timestamp. Useful for sorting without a join. */
export function timestampFromUuidV7(uuid: string): Date {
  const bytes = uuidToBytes(uuid)
  let ms = 0
  for (let i = 0; i < 6; i++) ms = ms * 256 + (bytes[i] as number)
  return new Date(ms)
}

/**
 * Request ids are generated in-process on every request, before any database
 * round trip, so they use randomUUID rather than a Postgres uuidv7.
 */
export function newRequestId(): string {
  return `${ID_PREFIXES.request}_${toBase32(crypto.getRandomValues(new Uint8Array(16)))}`
}
