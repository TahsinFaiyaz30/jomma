#!/usr/bin/env node
/**
 * Smoke test for the signed ingest endpoint.
 *
 * Kept apart from scripts/smoke.mjs because it authenticates with the webhook
 * signing secret rather than an API key or a device token, and because a
 * misconfigured secret should fail loudly on its own rather than as one line
 * inside a fifty-check run.
 *
 * Usage: node scripts/smoke-ingest.mjs <api_key> <receiving_msisdn>
 */

import { createHmac, randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'

const BASE = process.env.JOMMA_URL ?? 'http://localhost:3000'
const [apiKey, msisdn = '8801799887766'] = process.argv.slice(2)

if (!apiKey) {
  console.error('Usage: node scripts/smoke-ingest.mjs <api_key> [receiving_msisdn]')
  console.error('Run `pnpm db:seed` to mint one.')
  process.exit(1)
}

const secret =
  process.env.WEBHOOK_SIGNING_SECRET ??
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split('\n')
    .find((line) => line.startsWith('WEBHOOK_SIGNING_SECRET='))
    ?.split('=')[1]
    ?.trim()

if (!secret) {
  console.error('WEBHOOK_SIGNING_SECRET not found in the environment or .env')
  process.exit(1)
}

let passed = 0
let failed = 0

function check(label, condition, detail) {
  if (condition) {
    passed += 1
    console.log(`  ok    ${label}`)
  } else {
    failed += 1
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

function section(name) {
  console.log(`\n${name}`)
}

/** Sign exactly the bytes that will be sent. */
async function post(rawBody, { timestamp = Math.floor(Date.now() / 1000), tamper = false } = {}) {
  const digest = createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex')
  const signature = tamper ? digest.replace(/^./, (c) => (c === 'a' ? 'b' : 'a')) : digest

  const response = await fetch(`${BASE}/ingest/v1/webhook`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-jomma-signature': `t=${timestamp},v1=${signature}`,
    },
    body: rawBody,
  })

  return { status: response.status, body: await response.json().catch(() => ({})) }
}

function trxId() {
  return randomBytes(5).toString('hex').toUpperCase()
}

/** The format in docs/api.md — dd/mm/yyyy, as bKash actually sends it. */
function bkashMessage({ amount, ref, trx, sender = '01712345678' }) {
  const now = new Date()
  const stamp =
    `${String(now.getDate()).padStart(2, '0')}/` +
    `${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()} ` +
    `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`

  return (
    `You have received Tk ${amount.toFixed(2)} from ${sender}. ` +
    `Ref ${ref}. Fee Tk 0.00. TrxID ${trx} at ${stamp}`
  )
}

async function createIntent(amount, reference) {
  const response = await fetch(`${BASE}/v1/intents`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
      'idempotency-key': randomBytes(8).toString('hex'),
    },
    body: JSON.stringify({ amount, client_reference: reference, ttl_seconds: 600 }),
  })
  return response.json()
}

async function main() {
  console.log(`Ingest webhook — ${BASE}`)

  /* ── Authentication ───────────────────────────────────────────────────── */

  section('Signature')

  const unsigned = await fetch(`${BASE}/ingest/v1/webhook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ msisdn, raw: 'anything' }),
  })
  check('an unsigned request is rejected', unsigned.status === 401, `got ${unsigned.status}`)

  const tampered = await post(JSON.stringify({ msisdn, raw: 'anything' }), { tamper: true })
  check('a bad signature is rejected', tampered.status === 401, `got ${tampered.status}`)

  const stale = await post(JSON.stringify({ msisdn, raw: 'anything' }), {
    timestamp: Math.floor(Date.now() / 1000) - 3600,
  })
  check('a replayed request is rejected', stale.status === 401, `got ${stale.status}`)

  /* ── Capture ──────────────────────────────────────────────────────────── */

  section('Capture')

  // A random amount: an exclusive lock on (account, amount) means a fixed one
  // collides with whatever a previous run left open.
  const amountCents = 40_000 + Math.floor(Math.random() * 50_000)
  const intent = await createIntent(amountCents, `INGEST-${Date.now()}`)
  check('intent created', Boolean(intent.ref_code), JSON.stringify(intent))

  const trx = trxId()
  const message = bkashMessage({ amount: amountCents / 100, ref: intent.ref_code, trx })

  // Address the account the intent was actually routed to. The receiving
  // account is a gate in the matcher, so posting to the other number would be
  // a correct non-match and would tell us nothing.
  const target = intent.receiving_account?.msisdn ?? msisdn
  const accepted = await post(JSON.stringify({ msisdn: target, raw: message }))
  check('a signed capture is accepted', accepted.status === 200, JSON.stringify(accepted.body))
  check('the TrxID is echoed back', accepted.body.trx_id === trx, accepted.body.trx_id)
  check('status is accepted', accepted.body.status === 'accepted', accepted.body.status)
  check('it matched the intent', accepted.body.matched === true, String(accepted.body.matched))
  check('a request_id is returned', Boolean(accepted.body.request_id))

  const repeat = await post(JSON.stringify({ msisdn: target, raw: message }))
  check(
    'the same message twice is a duplicate',
    repeat.body.status === 'duplicate',
    repeat.body.status,
  )

  /* ── Unparseable input ────────────────────────────────────────────────── */

  section('Unparseable input')

  const garbage = await post(
    JSON.stringify({ msisdn, raw: 'Your recharge of 30 taka was successful.' }),
  )
  check('stored rather than dropped', garbage.status === 200, JSON.stringify(garbage.body))
  check('reported as unparsed', garbage.body.status === 'unparsed', garbage.body.status)

  /* ── Routing ──────────────────────────────────────────────────────────── */

  section('Routing')

  const unknown = await post(JSON.stringify({ msisdn: '8809999999999', raw: 'anything' }))
  check('an unknown receiving number is rejected', unknown.status === 404, `got ${unknown.status}`)

  const malformed = await post('{ not json')
  check('a malformed body is rejected', malformed.status === 422, `got ${malformed.status}`)

  console.log(`\n${passed} passed, ${failed} failed`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
