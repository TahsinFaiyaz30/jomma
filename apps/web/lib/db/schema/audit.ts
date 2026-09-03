import { index, jsonb, pgTable, text } from 'drizzle-orm/pg-core'
import { createdAt, fkId, primaryId } from './_shared'
import { apps } from './apps'
import { auditActionEnum } from './enums'
import { incomingPayments, paymentIntents } from './payments'

/**
 * Append-only. Nothing updates or deletes a row here.
 *
 * This is what makes a reversal defensible: if the matcher ever approves the
 * wrong intent, the trail shows exactly what was seen, what scored what, and who
 * (or what) decided. A payment applied to the wrong order and then reversed
 * leaves three rows, not an edited one.
 */
export const paymentAudit = pgTable(
  'payment_audit',
  {
    id: primaryId(),
    action: auditActionEnum('action').notNull(),

    /** Null actor means the system did it. Otherwise an admin user id. */
    actorId: fkId('actor_id'),
    actorType: text('actor_type').notNull().default('system'),

    appId: fkId('app_id').references(() => apps.id, { onDelete: 'set null' }),
    intentId: fkId('intent_id').references(() => paymentIntents.id, {
      onDelete: 'set null',
    }),
    incomingPaymentId: fkId('incoming_payment_id').references(() => incomingPayments.id, {
      onDelete: 'set null',
    }),

    /** The request that caused it. Joins the dashboard's request inspector to the trail. */
    requestId: text('request_id'),

    payload: jsonb('payload').notNull().default({}).$type<Record<string, unknown>>(),
    createdAt: createdAt(),
  },
  (table) => [
    index('ix_audit_intent').on(table.intentId, table.createdAt),
    index('ix_audit_payment').on(table.incomingPaymentId, table.createdAt),
    index('ix_audit_recent').on(table.createdAt),
    index('ix_audit_action').on(table.action, table.createdAt),
  ],
)
