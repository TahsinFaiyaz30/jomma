import { boolean, pgTable, text } from 'drizzle-orm/pg-core'
import { createdAt, timestampTz } from './_shared'

/**
 * Facts about this deployment rather than about anybody's payments.
 *
 * One row, enforced by a primary key that can only hold one value. A `where id
 * = true` read is cheap enough for the dashboard layout to do on every request.
 *
 * It exists for a single question the live tables cannot answer: has this
 * instance *ever* been set up? Capability is easy to compute — is there a
 * routable account, a paired phone, a live key — but capability is not history.
 * An operator taking their only number out of rotation for an afternoon, which
 * is a one-click supported action, looks identical to a deployment that was
 * never configured. Only one of those should be met with a setup wizard.
 */
export const instanceSetup = pgTable('instance_setup', {
  /** Always `true`. The primary key is what makes the row a singleton. */
  id: boolean('id').primaryKey().default(true),

  /**
   * Stamped the first time every required step was satisfied, and never
   * cleared. Deleting the last account does not un-happen the setup.
   */
  completedAt: timestampTz('completed_at'),

  /** Which version marked it, so a future migration can tell what it meant. */
  completedBy: text('completed_by'),

  createdAt: createdAt(),
})
