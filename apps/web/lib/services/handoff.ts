import 'server-only'

import { randomBytes } from 'node:crypto'
import { eq, sql } from 'drizzle-orm'
import { constantTimeEqual } from '@/lib/auth/tokens'
import { db } from '@/lib/db/client'
import { paymentIntents } from '@/lib/db/schema'

/**
 * Carrying the instructions to the phone that can act on them.
 *
 * The pay page is a short queue of questions — which wallet, which number —
 * and then the instructions. The QR at the end of it encodes the page's own
 * URL, so scanning it opens a browser on a phone that has never seen any of
 * those answers and starts the queue again. A buyer scans a code precisely to
 * avoid retyping, and gets asked "how would you like to pay?" a second time.
 *
 * A handoff token fixes that by saying, in the URL, *which* screen the QR was
 * printed on. A page opened with a live token is a continuation of a session
 * that already answered, so it skips straight to the number, the amount and the
 * reference, and it offers no way back — see `PayClient`. The questions belong
 * to the screen that asked them.
 *
 * ## Why it is revocable
 *
 * Because the answers are still changeable on the other screen. The buyer can
 * go back and pick a different wallet, and `switchCheckoutMethod` moves the
 * intent to a different receiving account when they do — so the phone would be
 * holding a number that is no longer the one to send to. Money sent there is
 * money sent to the wrong account, by somebody who is looking at a page Jomma
 * printed.
 *
 * So going back revokes: the token is cleared, the QR stops resolving, and the
 * phone's page stops showing an instruction it can no longer stand behind. That
 * is the point of the whole mechanism, and the reason it is a column rather
 * than something derived — a scanned page has to be able to find out that the
 * screen it came from has moved on.
 *
 * ## What it is not
 *
 * Not a credential. It grants nothing that the pay link does not already grant,
 * and every endpoint the scanned page reaches still checks the intent itself.
 * It is a session marker for one payment on one buyer's two screens.
 */

/** 144 bits, URL-safe, no padding: 24 characters in a query string. */
function mintToken(): string {
  return randomBytes(18).toString('base64url')
}

/**
 * The live token for this intent, minting one if there is none.
 *
 * Idempotent by construction rather than by check-then-write. `coalesce` in the
 * UPDATE means two tabs — or React mounting an effect twice — race to the same
 * row and both come away with whichever token won, instead of the second one
 * silently invalidating the QR the first is already displaying.
 *
 * Only while the intent is open. A closed one has no instructions left to carry
 * and returns null, which the caller shows as no QR at all.
 */
export async function issueHandoff(intentId: string): Promise<string | null> {
  const [row] = await db
    .update(paymentIntents)
    .set({ handoffToken: sql`coalesce(${paymentIntents.handoffToken}, ${mintToken()})` })
    .where(eq(paymentIntents.id, intentId))
    .returning({ token: paymentIntents.handoffToken })

  return row?.token ?? null
}

/**
 * Cut the phone loose. Called when the buyer leaves the instructions.
 *
 * Unconditional on status: a token outliving its usefulness is the failure this
 * exists to prevent, so there is no state in which refusing to clear it is the
 * safer answer.
 */
export async function revokeHandoff(intentId: string): Promise<void> {
  await db.update(paymentIntents).set({ handoffToken: null }).where(eq(paymentIntents.id, intentId))
}

/**
 * Whether a token presented in a URL is the one this intent is handing out.
 *
 * False for a revoked session, for a stale QR photographed earlier, and for a
 * link forwarded after the buyer went back — which are the same event seen from
 * three places, and all three must stop showing a number.
 */
export async function handoffIsLive(intentId: string, presented: string): Promise<boolean> {
  if (presented.length === 0) return false

  const [row] = await db
    .select({ token: paymentIntents.handoffToken })
    .from(paymentIntents)
    .where(eq(paymentIntents.id, intentId))
    .limit(1)

  return row?.token ? constantTimeEqual(row.token, presented) : false
}
