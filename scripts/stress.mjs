#!/usr/bin/env node
/**
 * Concurrency stress.
 *
 * Money bugs hide in races, and this repo just replaced the guard that was
 * serialising concurrent applications to one intent — the amount lock's
 * conditional update — with an explicit row lock. That swap deserves proof
 * rather than reasoning.
 *
 * Everything here runs requests genuinely in parallel and then asks the
 * database whether the books balance. The invariants are the same three every
 * time: an intent's `received_amount_cents` equals the sum of its unreversed
 * applications, a TrxID is spent at most once, and nothing is credited twice.
 *
 *
 * Note: run the suites a minute apart. They share a per-IP rate limit with each
 * other and with the audit's burst test, so back-to-back runs from one machine
 * throttle each other — which is the limiter working, not a failure.
 * Usage: node scripts/stress.mjs <api_key>
 */

import { createHmac, randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'

const BASE = process.env.JOMMA_URL ?? 'http://localhost:3000'
const [apiKey] = process.argv.slice(2)

if (!apiKey) {
  console.error('Usage: node scripts/stress.mjs <api_key>')
  process.exit(1)
}

const secret = readFileSync(new URL('../.env', import.meta.url), 'utf8')
  .split('\n')
  .find((l) => l.startsWith('WEBHOOK_SIGNING_SECRET='))
  ?.split('=')[1]
  ?.trim()

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

const section = (n) => console.log(`\n${n}`)
const trxId = () => randomBytes(5).toString('hex').toUpperCase()

function stamp() {
  const at = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${p(at.getDate())}/${p(at.getMonth() + 1)}/${at.getFullYear()} ${p(at.getHours())}:${p(at.getMinutes())}`
}

const message = ({ taka, ref, trx, sender = '01712345678' }) =>
  `You have received Tk ${taka.toFixed(2)} from ${sender}. ${ref ? `Ref ${ref}. ` : ''}` +
  `Fee Tk 0.00. Balance Tk 45,320.00. TrxID ${trx} at ${stamp()}`

async function capture(msisdn, raw) {
  const body = JSON.stringify({ msisdn, raw, source: 'generic_webhook' })
  const ts = Math.floor(Date.now() / 1000)
  const sig = createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex')
  const r = await fetch(`${BASE}/ingest/v1/webhook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-jomma-signature': `t=${ts},v1=${sig}` },
    body,
  })
  return r.json()
}

async function createIntent(amount, extra = {}) {
  const r = await fetch(`${BASE}/v1/intents`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
      'idempotency-key': randomBytes(8).toString('hex'),
    },
    body: JSON.stringify({
      amount,
      client_reference: `STRESS-${Date.now()}-${randomBytes(2).toString('hex')}`,
      ttl_seconds: 900,
      payer_msisdn: '01712345678',
      ...extra,
    }),
  })
  return r.json()
}

const status = (id) => fetch(`${BASE}/api/pay/${id}/status`).then((r) => r.json())

async function main() {
  console.log(`Concurrency stress — ${BASE}`)

  /* ── 1. Many instalments landing at once ──────────────────────────────── */

  section('Simultaneous instalments against one intent')

  const parts = [100_00, 150_00, 200_00, 250_00, 300_00]
  const total = parts.reduce((a, b) => a + b, 0)
  const intent = await createIntent(total)
  check('intent created', Boolean(intent.ref_code), JSON.stringify(intent))

  const msisdn = intent.receiving_account.msisdn

  // All five at once. Each is short of the balance, so each is a part payment
  // and every one has to read-modify-write received_amount_cents.
  await Promise.all(
    parts.map((taka) =>
      capture(msisdn, message({ taka: taka / 100, ref: intent.ref_code, trx: trxId() })),
    ),
  )

  const after = await status(intent.id)
  check(
    'every instalment was counted',
    after.received_amount === total,
    `expected ${total}, got ${after.received_amount}`,
  )
  check('all five are linked', after.payments?.length === 5, `got ${after.payments?.length}`)
  check(
    'the ledger sums to the recorded total',
    after.payments?.reduce((s, p) => s + p.amount, 0) === after.received_amount,
  )
  check('the order is complete', after.status === 'matched', after.status)
  check('with nothing outstanding', after.shortfall === 0, String(after.shortfall))

  /* ── 2. The same TrxID submitted many times at once ───────────────────── */

  section('One TrxID, twenty simultaneous claims')

  const dupTotal = 60_000 + Math.floor(Math.random() * 20_000)
  const dupIntent = await createIntent(dupTotal)
  const dupTrx = trxId()

  // No reference, so it does not auto-match — the submissions are the only way
  // in, and they all race for the same payment.
  await capture(dupIntent.receiving_account.msisdn, message({ taka: dupTotal / 100, trx: dupTrx }))

  const claims = await Promise.all(
    Array.from({ length: 20 }, () =>
      fetch(`${BASE}/api/pay/${dupIntent.id}/submit`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ trx_id: dupTrx }),
      }).then(async (r) => ({ status: r.status, body: await r.json() })),
    ),
  )

  const dupAfter = await status(dupIntent.id)
  check(
    'the payment is counted exactly once',
    dupAfter.received_amount === dupTotal,
    `expected ${dupTotal}, got ${dupAfter.received_amount}`,
  )
  check(
    'and appears once in the ledger',
    dupAfter.payments?.length === 1,
    `got ${dupAfter.payments?.length}`,
  )
  check(
    'no claim returned a 500',
    claims.every((c) => c.status < 500),
    [...new Set(claims.map((c) => c.status))].join(','),
  )

  /* ── 3. One TrxID, two different intents ──────────────────────────────── */

  section('One TrxID claimed by two orders at once')

  const amountA = 45_000 + Math.floor(Math.random() * 10_000)
  const [intentA, intentB] = await Promise.all([createIntent(amountA), createIntent(amountA)])
  const sharedTrx = trxId()
  await capture(intentA.receiving_account.msisdn, message({ taka: amountA / 100, trx: sharedTrx }))

  await Promise.all(
    [intentA, intentB].map((i) =>
      fetch(`${BASE}/api/pay/${i.id}/submit`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ trx_id: sharedTrx }),
      }),
    ),
  )

  const [a, b] = await Promise.all([status(intentA.id), status(intentB.id)])
  const creditedTo = [a, b].filter((s) => s.received_amount > 0)
  check(
    'the money lands on exactly one of them',
    creditedTo.length === 1,
    `credited to ${creditedTo.length} intents`,
  )
  check(
    'and is never counted twice',
    a.received_amount + b.received_amount === amountA,
    `${a.received_amount} + ${b.received_amount}`,
  )

  /* ── 4. Duplicate delivery of the same capture ────────────────────────── */

  section('The same message delivered ten times at once')

  const dupCapTotal = 35_000 + Math.floor(Math.random() * 10_000)
  const dupCapIntent = await createIntent(dupCapTotal)
  const raw = message({
    taka: dupCapTotal / 100,
    ref: dupCapIntent.ref_code,
    trx: trxId(),
  })

  const results = await Promise.all(
    Array.from({ length: 10 }, () => capture(dupCapIntent.receiving_account.msisdn, raw)),
  )
  const accepted = results.filter((r) => r.status === 'accepted').length
  const duplicates = results.filter((r) => r.status === 'duplicate').length

  check('exactly one delivery is accepted', accepted === 1, `accepted ${accepted}`)
  check('the other nine are duplicates', duplicates === 9, `duplicates ${duplicates}`)

  const dupCapAfter = await status(dupCapIntent.id)
  check(
    'and the amount is counted once',
    dupCapAfter.received_amount === dupCapTotal,
    `expected ${dupCapTotal}, got ${dupCapAfter.received_amount}`,
  )

  /* ── 5. Idempotency under parallel load ───────────────────────────────── */

  section('One idempotency key, ten simultaneous creates')

  const key = randomBytes(8).toString('hex')
  const idemAmount = 25_000 + Math.floor(Math.random() * 10_000)
  const reference = `IDEM-${Date.now()}`

  const creates = await Promise.all(
    Array.from({ length: 10 }, () =>
      fetch(`${BASE}/v1/intents`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json',
          'idempotency-key': key,
        },
        body: JSON.stringify({
          amount: idemAmount,
          client_reference: reference,
          ttl_seconds: 900,
          payer_msisdn: '01712345678',
        }),
      }).then((r) => r.json()),
    ),
  )

  const ids = new Set(creates.map((c) => c.id).filter(Boolean))
  check('only one intent is created', ids.size === 1, `got ${ids.size} distinct ids`)
  const codes = new Set(creates.map((c) => c.ref_code).filter(Boolean))
  check('and only one reference code is issued', codes.size === 1, `got ${codes.size} codes`)

  console.log(`\n${passed} passed, ${failed} failed`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
