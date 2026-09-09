import { boolean, integer, jsonb, pgTable, text } from 'drizzle-orm/pg-core'
import { createdAt, timestampTz, updatedAt } from './_shared'

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

/**
 * When each group of scheduled work last actually ran.
 *
 * The scheduler is the only component whose failure is completely silent. A
 * phone that stops capturing raises an alert; a parser that breaks raises an
 * alert; an account that goes unroutable turns the checkout red. All three of
 * those alerts are raised *by* the scheduled jobs — so when the jobs themselves
 * are not running, every one of those detectors is off, and the symptoms that
 * do reach an operator point somewhere else entirely.
 *
 * That failure is not hypothetical: this instance ran for two days with no
 * worker and no cron. Twenty webhooks sat queued at zero attempts, intents kept
 * reporting `open` a day past their deadline, and the only sign anywhere was a
 * shop's stock never being released. The integrator had to query their own
 * database to discover that *nothing* had ever arrived.
 *
 * So the jobs stamp a row here every time they run, and the dashboard reads it
 * on render — a path that works precisely when the scheduler does not. One row
 * per group, upserted, because the question is "when last", never "how often".
 */
export const jobRuns = pgTable('job_runs', {
  /** A `JobGroup`. Text rather than an enum so adding a group is not a migration. */
  group: text('group').primaryKey(),

  startedAt: timestampTz('started_at').notNull(),
  finishedAt: timestampTz('finished_at').notNull(),
  durationMs: integer('duration_ms').notNull(),

  /**
   * The counters the run produced, as returned to the caller.
   *
   * Kept so "the jobs are running" can be told apart from "the jobs are running
   * and doing nothing", which look identical from a timestamp alone.
   */
  lastResult: jsonb('last_result').notNull().default({}).$type<Record<string, unknown>>(),

  createdAt: createdAt(),
  updatedAt: updatedAt(),
})
