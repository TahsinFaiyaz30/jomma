import { randomInt } from 'node:crypto'
import { env } from '@jomma/shared/env'
import { and, eq, gt, or, sql } from 'drizzle-orm'
import type { Database, Tx } from '@/lib/db/client'
import { paymentRefs } from '@/lib/db/schema'

/**
 * Reference codes.
 *
 * Four characters from a 32-symbol alphabet: ~1M combinations, which is ample
 * against the handful of codes open at any moment and short enough that a buyer
 * will actually type it into the bKash reference field.
 *
 * I, L, O, 0 and 1 are excluded. A buyer reading a code off a screen and typing
 * it on a phone keypad confuses those constantly, and every confusion costs a
 * Levenshtein-1 fuzzy match at best and a manual review at worst.
 */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
export const REF_CODE_LENGTH = 4
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
 * Two constraints, not one:
 *
 * - The partial unique index rejects a code that is currently `open`.
 * - `cooldownUntil` keeps a code out of circulation for 24 hours after it
 *   expires, so a buyer who pays late cannot land on the next buyer who happened
 *   to draw the same four characters.
 *
 * Both are checked up front and the unique index is relied on to settle races,
 * so two concurrent creates can never both win the same code.
 */
export async function allocateRefCode(
  tx: Database | Tx,
  intentId: string,
  expiresAt: Date,
  now: Date = new Date(),
): Promise<string> {
  const cooldownSeconds = env().REF_CODE_COOLDOWN_SECONDS
  const cooldownUntil = new Date(expiresAt.getTime() + cooldownSeconds * 1000)

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const code = randomRefCode()

    const blocked = await tx
      .select({ id: paymentRefs.id })
      .from(paymentRefs)
      .where(
        and(
          eq(paymentRefs.code, code),
          or(eq(paymentRefs.status, 'open'), gt(paymentRefs.cooldownUntil, now)),
        ),
      )
      .limit(1)

    if (blocked.length > 0) continue

    try {
      await tx.insert(paymentRefs).values({
        code,
        intentId,
        status: 'open',
        expiresAt,
        cooldownUntil,
      })
      return code
    } catch (error) {
      // 23505 = unique_violation. Another request took this code between the
      // check and the insert; draw again.
      if (isUniqueViolation(error)) continue
      throw error
    }
  }

  throw new RefPoolExhausted()
}

/** Marks the code consumed. The cooldown clock keeps running from expiry. */
export async function consumeRefCode(tx: Database | Tx, intentId: string, now = new Date()) {
  await tx
    .update(paymentRefs)
    .set({ status: 'consumed', consumedAt: now })
    .where(and(eq(paymentRefs.intentId, intentId), eq(paymentRefs.status, 'open')))
}

/** Cancel and expiry both land here: the code stops matching immediately. */
export async function expireRefCode(tx: Database | Tx, intentId: string, now = new Date()) {
  await tx
    .update(paymentRefs)
    .set({
      status: 'expired',
      cooldownUntil: sql`greatest(${paymentRefs.cooldownUntil}, ${new Date(
        now.getTime() + env().REF_CODE_COOLDOWN_SECONDS * 1000,
      ).toISOString()}::timestamptz)`,
    })
    .where(and(eq(paymentRefs.intentId, intentId), eq(paymentRefs.status, 'open')))
}

/** Pushes an open code's expiry out, used by POST /v1/intents/:id/extend. */
export async function extendRefCode(tx: Database | Tx, intentId: string, expiresAt: Date) {
  await tx
    .update(paymentRefs)
    .set({
      expiresAt,
      cooldownUntil: new Date(expiresAt.getTime() + env().REF_CODE_COOLDOWN_SECONDS * 1000),
    })
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
