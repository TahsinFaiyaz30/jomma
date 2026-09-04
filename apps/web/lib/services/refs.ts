import { randomInt } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import type { Database, Tx } from '@/lib/db/client'
import { paymentRefs } from '@/lib/db/schema'

/**
 * Reference codes.
 *
 * Eight characters from a 31-symbol alphabet: 31^8, about 853 billion. A
 * provider's reference field takes far more than eight, so length is the
 * cheapest entropy available and there is no reason to be stingy with it.
 *
 * **A code is never issued twice.** Not once per open intent, not once per
 * payer, not once per provider — once, ever. That is a unique index across the
 * whole table rather than a probability argument, so it holds however many
 * codes are drawn. The generator can still collide; the database catches it and
 * the loop draws again, which means every code that reaches a buyer is provably
 * distinct from every code that ever has.
 *
 * This replaced a 24-hour cooldown after expiry. A cooldown only narrowed the
 * window in which a late payment could land on the next buyer holding the same
 * code. Permanent uniqueness closes it.
 *
 * I, L, O, 0 and 1 are excluded. A buyer reading a code off a screen and typing
 * it on a phone keypad confuses those constantly, and every confusion is a
 * payment that does not match automatically.
 *
 * No punctuation, deliberately. `normalizeRef` strips non-alphanumerics before
 * comparing, so a symbol in the code would be discarded by our own matcher, and
 * whether a provider's field preserves one is unverified. It would buy entropy
 * we do not need at the cost of transcription errors we cannot afford. Matching
 * is case-insensitive — both sides are upper-cased first.
 */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
export const REF_CODE_LENGTH = 8
export const REF_CODE_SPACE = ALPHABET.length ** REF_CODE_LENGTH

const MAX_ATTEMPTS = 12

export function randomRefCode(): string {
  let code = ''
  for (let i = 0; i < REF_CODE_LENGTH; i++) {
    code += ALPHABET[randomInt(0, ALPHABET.length)]
  }
  return code
}

export class RefPoolExhausted extends Error {
  constructor() {
    super('Could not allocate a free reference code.')
    this.name = 'RefPoolExhausted'
  }
}

/**
 * Allocates a code and writes the row, inside the caller's transaction.
 *
 * The unique index is the guarantee, not the pre-check. Any check-then-insert
 * leaves a window between the two, so the insert is simply attempted and a
 * 23505 means somebody drew the same code first — draw again. Twelve attempts
 * against 853 billion values is not a limit anybody reaches; it exists so a
 * genuinely broken generator fails loudly instead of spinning forever.
 */
export async function allocateRefCode(
  tx: Database | Tx,
  intentId: string,
  expiresAt: Date,
): Promise<string> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const code = randomRefCode()

    try {
      await tx.insert(paymentRefs).values({ code, intentId, status: 'open', expiresAt })
      return code
    } catch (error) {
      if (isUniqueViolation(error)) continue
      throw error
    }
  }

  throw new RefPoolExhausted()
}

/** Marks the code consumed. It never returns to circulation. */
export async function consumeRefCode(tx: Database | Tx, intentId: string, now = new Date()) {
  await tx
    .update(paymentRefs)
    .set({ status: 'consumed', consumedAt: now })
    .where(and(eq(paymentRefs.intentId, intentId), eq(paymentRefs.status, 'open')))
}

/** Cancel and expiry both land here: the code stops matching immediately. */
export async function expireRefCode(tx: Database | Tx, intentId: string) {
  await tx
    .update(paymentRefs)
    .set({ status: 'expired' })
    .where(and(eq(paymentRefs.intentId, intentId), eq(paymentRefs.status, 'open')))
}

/** Pushes an open code's expiry out, used by POST /v1/intents/:id/extend. */
export async function extendRefCode(tx: Database | Tx, intentId: string, expiresAt: Date) {
  await tx
    .update(paymentRefs)
    .set({ expiresAt })
    .where(and(eq(paymentRefs.intentId, intentId), eq(paymentRefs.status, 'open')))
}

/**
 * Postgres 23505 = unique_violation.
 *
 * Drizzle wraps driver errors in a `DrizzleQueryError` and puts the pg error on
 * `cause`, so checking the top-level `code` alone silently misses every
 * constraint violation raised inside a query — which turns "this amount is
 * taken, try the next account" into a 500. Walk the chain.
 */
export function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error
  for (let depth = 0; depth < 5 && current; depth++) {
    if (
      typeof current === 'object' &&
      current !== null &&
      'code' in current &&
      (current as { code?: string }).code === '23505'
    ) {
      return true
    }
    current = (current as { cause?: unknown } | null)?.cause
  }
  return false
}
