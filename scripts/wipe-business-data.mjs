#!/usr/bin/env node
/**
 * Empties a deployment of everything except who can sign in.
 *
 * For an instance that was set up to try it out and now needs to start again
 * for real: every business, account, phone, app, key, intent and payment goes,
 * and the `user` / `account` / `session` rows Better Auth owns stay — so the
 * admin you bootstrapped still signs in, and lands on an empty setup wizard.
 *
 *   pnpm wipe:business-data
 *
 * ## This is not reversible
 *
 * There is no undo and no soft delete. `incoming_payments` is the record that
 * money arrived; deleting it deletes the evidence, and the audit trail that
 * refers to it goes with it. On an instance that has taken real payments this
 * is the wrong tool — offboard the business instead, or take a backup you have
 * restored from at least once.
 *
 * So it prints what it is about to destroy, with counts, and requires the host
 * to be typed back before it does anything.
 */

import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'

/*
 * The driver belongs to `apps/web`, not to the root.
 *
 * pnpm does not hoist, so a bare `import 'pg'` from a root-level script does
 * not resolve. The other scripts sidestep this by spawning a package script in
 * that directory; this one has no equivalent to spawn, so it borrows the
 * package's own resolution instead of gaining a dependency the root does not
 * otherwise need.
 */
const HERE = dirname(fileURLToPath(import.meta.url))
const pg = createRequire(resolve(HERE, '..', 'apps', 'web', 'package.json'))('pg')

/*
 * Delete order is the FK graph, leaves first.
 *
 * `payment_intents.receiving_account_id` and
 * `incoming_payments.receiving_account_id` are ON DELETE RESTRICT, and
 * `order_payments.incoming_payment_id` is too — deliberately, so a business
 * cannot be removed out from under money that was observed arriving. Which
 * means the cascade that would tidy this up on its own does not exist, and the
 * order below is load-bearing rather than decorative.
 */
const TABLES = [
  // Things that point at payments.
  'order_payments',
  'payment_submissions',
  'refund_requests',
  'payment_audit',
  'payment_refs',
  // The payments themselves, then what they were for.
  'incoming_payments',
  'payment_intents',
  // Delivery, then the endpoints and keys that describe it.
  'webhook_deliveries',
  'webhook_endpoints',
  'api_keys',
  'idempotency_keys',
  'apps',
  // Phones and what they watch.
  'notifier_events',
  'devices',
  'receiving_accounts',
  // Who belonged to what, then the businesses.
  'invitations',
  'memberships',
  'businesses',
]

/** Kept: these are the sign-in, not the data. */
const KEPT = ['user', 'account', 'session', 'verification', 'instance_setup']

const rl = createInterface({ input: process.stdin, output: process.stdout })

let abort = null
rl.on('close', () => abort?.())

function ask(question) {
  return new Promise((done, fail) => {
    abort = () => fail(new Error('Input ended before the wipe was confirmed.'))
    rl.question(question, (answer) => {
      abort = null
      done(answer.trim())
    })
  })
}

async function main() {
  console.log(`
Wiping business data.

  Keeps: ${KEPT.join(', ')} — so your admin can still sign in.
  Deletes: everything else, including every payment ever recorded.

  There is no undo.
`)

  const url = await ask('  DATABASE_URL : ')
  if (!url) throw new Error('A DATABASE_URL is required.')

  let host
  try {
    const parsed = new URL(url)
    host = `${parsed.hostname}${parsed.pathname}`
  } catch {
    throw new Error('That does not parse as a connection string.')
  }

  const client = new pg.Client({ connectionString: url })
  await client.connect()

  try {
    // Counted before anything is destroyed, so the confirmation is about the
    // database in front of you rather than the one you had in mind.
    console.log('\n  About to delete:\n')
    let total = 0
    for (const table of TABLES) {
      const { rows } = await client.query(`select count(*)::int as n from "${table}"`)
      const n = rows[0]?.n ?? 0
      total += n
      if (n > 0) console.log(`    ${String(n).padStart(6)}  ${table}`)
    }
    if (total === 0) console.log('    (nothing — this database is already empty)')

    const { rows: kept } = await client.query('select count(*)::int as n from "user"')
    console.log(`\n  Keeping ${kept[0]?.n ?? 0} sign-in account(s).`)

    // The host, typed back. A yes/no is too easy to give to the wrong database.
    const typed = await ask(`\n  Type the host to confirm — ${host} : `)
    if (typed !== host) throw new Error('That does not match. Nothing was deleted.')

    /*
     * One transaction. A wipe that stops halfway leaves a database that is
     * neither the old one nor an empty one, and the FK order above means the
     * failure would be somewhere in the middle by construction.
     */
    await client.query('begin')
    for (const table of TABLES) await client.query(`delete from "${table}"`)
    await client.query('commit')

    console.log(`
  Done. ${total} row(s) deleted.

  Sign in as before. You will land on the setup wizard with nothing configured:
  connect a phone, approve it, and choose the SIM you are paid on.
`)
  } catch (error) {
    await client.query('rollback').catch(() => {})
    throw error
  } finally {
    rl.close()
    await client.end()
  }
}

main().catch((error) => {
  console.error(`\n  ${error.message}\n`)
  process.exit(1)
})
