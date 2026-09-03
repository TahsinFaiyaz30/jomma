import type { AuditAction } from '@jomma/shared'
import type { Database, Tx } from '@/lib/db/client'
import { paymentAudit } from '@/lib/db/schema'

export interface AuditEntry {
  action: AuditAction
  actorId?: string | null
  actorType?: 'system' | 'admin' | 'device' | 'client'
  appId?: string | null
  intentId?: string | null
  incomingPaymentId?: string | null
  requestId?: string | null
  payload?: Record<string, unknown>
}

/**
 * Append-only. Every money-moving decision writes one of these, inside the same
 * transaction as the decision itself — an audit row that can be committed
 * separately from the thing it describes is worthless the first time something
 * crashes between the two.
 */
export async function audit(tx: Database | Tx, entry: AuditEntry): Promise<void> {
  await tx.insert(paymentAudit).values({
    action: entry.action,
    actorId: entry.actorId ?? null,
    actorType: entry.actorType ?? 'system',
    appId: entry.appId ?? null,
    intentId: entry.intentId ?? null,
    incomingPaymentId: entry.incomingPaymentId ?? null,
    requestId: entry.requestId ?? null,
    payload: entry.payload ?? {},
  })
}
