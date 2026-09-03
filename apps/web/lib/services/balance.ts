import { and, eq, gt, sql } from 'drizzle-orm'
import type { Tx } from '@/lib/db/client'
import { incomingPayments, notifierEvents, receivingAccounts } from '@/lib/db/schema'

/**
 * Balance continuity.
 *
 * The failure that kills this system is money arriving and nobody knowing. Every
 * bKash message reports the balance after the transaction, so each capture is a
 * checksum on every capture before it:
 *
 *     expected = last_known_balance
 *              + incoming since the last check
 *              - recorded outgoing since the last check
 *
 * A gap surfaces on the *next* payment, within minutes, instead of at the weekly
 * statement import.
 *
 * ── Known gap ────────────────────────────────────────────────────────────────
 * There is no outgoing-transaction table in the schema, so a refund or payout
 * sent from the account has nothing to net against and will register as drift.
 *
 * Rather than let that produce a false critical alert every time the shop sends
 * money — which is exactly how alarm fatigue starts, and docs/design.md calls
 * that out as a real failure mode — the two directions are graded differently:
 *
 *   balance LOWER than expected   money left the account we did not record.
 *                                 Almost always a legitimate outgoing send.
 *                                 Medium severity, keeps routing.
 *
 *   balance HIGHER than expected  money ARRIVED that we never saw. This is the
 *                                 dangerous case and the whole reason the check
 *                                 exists. Critical, stops routing.
 *
 * Add an `outgoing_payments` table and the alert can become symmetric.
 */

export interface DriftResult {
  checked: boolean
  driftCents: number
  expectedCents: number | null
  reportedCents: number | null
  severity: 'critical' | 'medium' | null
}

export async function checkBalanceContinuity(
  tx: Tx,
  options: {
    receivingAccountId: string
    reportedBalanceCents: number | null
    incomingPaymentId: string
    at?: Date
  },
): Promise<DriftResult> {
  const at = options.at ?? new Date()

  if (options.reportedBalanceCents === null) {
    // A partial parse with no balance. Nothing to check; the previous known
    // balance stays as the anchor so the next message with one still works.
    return {
      checked: false,
      driftCents: 0,
      expectedCents: null,
      reportedCents: null,
      severity: null,
    }
  }

  const account = await tx.query.receivingAccounts.findFirst({
    where: eq(receivingAccounts.id, options.receivingAccountId),
  })
  if (!account) {
    return {
      checked: false,
      driftCents: 0,
      expectedCents: null,
      reportedCents: null,
      severity: null,
    }
  }

  // First balance we have ever seen for this account: adopt it as the anchor.
  if (account.lastKnownBalanceCents === null || account.balanceCheckedAt === null) {
    await tx
      .update(receivingAccounts)
      .set({
        lastKnownBalanceCents: options.reportedBalanceCents,
        balanceCheckedAt: at,
      })
      .where(eq(receivingAccounts.id, options.receivingAccountId))
    return {
      checked: false,
      driftCents: 0,
      expectedCents: null,
      reportedCents: options.reportedBalanceCents,
      severity: null,
    }
  }

  // Everything observed since the anchor, including the capture being processed.
  const [sums] = await tx
    .select({
      total: sql<string>`coalesce(sum(${incomingPayments.amountCents}), 0)`,
    })
    .from(incomingPayments)
    .where(
      and(
        eq(incomingPayments.receivingAccountId, options.receivingAccountId),
        gt(incomingPayments.receivedAt, account.balanceCheckedAt),
      ),
    )

  const incomingSince = Number(sums?.total ?? 0)
  const expectedCents = account.lastKnownBalanceCents + incomingSince
  const driftCents = options.reportedBalanceCents - expectedCents

  // The reported balance is ground truth either way — re-anchor to it, or the
  // same drift is re-reported on every subsequent capture.
  const severity = driftCents === 0 ? null : driftCents > 0 ? 'critical' : 'medium'

  await tx
    .update(receivingAccounts)
    .set({
      lastKnownBalanceCents: options.reportedBalanceCents,
      balanceCheckedAt: at,
      ...(severity === 'critical'
        ? {
            balanceDrift: true,
            balanceDriftCents: driftCents,
            status: 'degraded' as const,
            statusReason: `Balance drift of ${driftCents} poisha — a payment may have been missed.`,
          }
        : {}),
    })
    .where(eq(receivingAccounts.id, options.receivingAccountId))

  if (severity) {
    await tx.insert(notifierEvents).values({
      receivingAccountId: options.receivingAccountId,
      kind: 'balance_drift',
      severity,
      detail:
        severity === 'critical'
          ? 'Reported balance is higher than expected — a payment was probably missed.'
          : 'Reported balance is lower than expected — most likely an unrecorded outgoing send.',
      payload: {
        expected_cents: expectedCents,
        reported_cents: options.reportedBalanceCents,
        drift_cents: driftCents,
        incoming_since_cents: incomingSince,
        anchor_balance_cents: account.lastKnownBalanceCents,
        anchor_checked_at: account.balanceCheckedAt.toISOString(),
        incoming_payment_id: options.incomingPaymentId,
      },
    })
  }

  return {
    checked: true,
    driftCents,
    expectedCents,
    reportedCents: options.reportedBalanceCents,
    severity,
  }
}
