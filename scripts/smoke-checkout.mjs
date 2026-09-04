#!/usr/bin/env node
/**
 * The hosted checkout flow, end to end.
 *
 * Covers what a buyer actually does on /pay/:id: pick a method, declare their
 * number, pay, and — when automatic matching has not happened — prove it with a
 * TrxID. Including the case that matters most and is easiest to get wrong,
 * paying in two instalments.
 *
 * Usage: node scripts/smoke-checkout.mjs <api_key>
 */

import { createHmac, randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'

const BASE = process.env.JOMMA_URL ?? 'http://localhost:3000'
const [apiKey] = process.argv.slice(2)

if (!apiKey) {
  console.error('Usage: node scripts/smoke-checkout.mjs <api_key>')
  process.exit(1)
}

const secret =
  process.env.WEBHOOK_SIGNING_SECRET ??
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split('\n')
    .find((line) => line.startsWith('WEBHOOK_SIGNING_SECRET='))
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

const section = (name) => console.log(`\n${name}`)
const trxId = () => randomBytes(5).toString('hex').toUpperCase()

/**
 * A bKash send-money message.
 *
 * `ref` is optional on purpose: leaving it out is how a buyer who skipped the
 * reference field is simulated, and that is the only case where the manual
 * TrxID path is still load-bearing — with a reference, a short payment now
 * verifies itself.
 */
function bkashMessage({ taka, ref, trx, sender = '01712345678' }) {
  const now = new Date()
  const stamp =
    `${String(now.getDate()).padStart(2, '0')}/` +
    `${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()} ` +
    `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
  return (
    `You have received Tk ${taka.toFixed(2)} from ${sender}. ` +
    `${ref ? `Ref ${ref}. ` : ''}Fee Tk 0.00. ` +
    `Balance Tk 45,320.00. TrxID ${trx} at ${stamp}`
  )
}

/** Deliver a captured message the way the notifier would. */
async function capture(msisdn, raw) {
  const body = JSON.stringify({ msisdn, raw, source: 'generic_webhook' })
  const timestamp = Math.floor(Date.now() / 1000)
  const digest = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')

  const response = await fetch(`${BASE}/ingest/v1/webhook`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-jomma-signature': `t=${timestamp},v1=${digest}`,
    },
    body,
  })
  return response.json()
}

async function createIntent(amountCents, extra = {}) {
  const response = await fetch(`${BASE}/v1/intents`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
      'idempotency-key': randomBytes(8).toString('hex'),
    },
    body: JSON.stringify({
      amount: amountCents,
      client_reference: `CHECKOUT-${Date.now()}-${randomBytes(2).toString('hex')}`,
      ttl_seconds: 900,
      ...extra,
    }),
  })
  return response.json()
}

const pay = (id, path, body) =>
  fetch(`${BASE}/api/pay/${id}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })

async function main() {
  console.log(`Hosted checkout — ${BASE}`)

  /* ── Methods ──────────────────────────────────────────────────────────── */

  section('Payment methods')

  const anyIntent = await createIntent(50_000 + Math.floor(Math.random() * 40_000), {
    provider: 'any',
  })
  check('intent created with provider "any"', Boolean(anyIntent.id), JSON.stringify(anyIntent))

  const page = await (await pay(anyIntent.id, '/status')).json()
  check('status is public and open', page.status === 'open', page.status)

  const switched = await pay(anyIntent.id, '/method', { provider: 'bkash' })
  const switchBody = await switched.json()
  check('method endpoint answers', switched.status === 200, `got ${switched.status}`)
  check('methods are listed', Array.isArray(switchBody.methods), JSON.stringify(switchBody))

  const nagad = switchBody.methods?.find((m) => m.provider === 'nagad')
  check(
    'nagad is offered but not selectable, since its parser is a stub',
    nagad && nagad.available === false && Boolean(nagad.reason),
    JSON.stringify(nagad),
  )

  const nagadSwitch = await pay(anyIntent.id, '/method', { provider: 'nagad' })
  check('switching to nagad is refused', nagadSwitch.status === 409, `got ${nagadSwitch.status}`)

  /* ── The buyer's number ───────────────────────────────────────────────── */

  section('Declaring the payer')

  const first = await pay(anyIntent.id, '/payer', { msisdn: '01712345678' })
  const firstBody = await first.json()
  check('accepted', first.status === 200 && firstBody.stored === true, JSON.stringify(firstBody))

  const second = await pay(anyIntent.id, '/payer', { msisdn: '01999999999' })
  const secondBody = await second.json()
  check('write-once: a second number does not overwrite', secondBody.stored === false)

  /* ── TrxID verification ───────────────────────────────────────────────── */

  section('Verify by TrxID')

  const invented = await pay(anyIntent.id, '/submit', { trx_id: trxId() })
  const inventedBody = await invented.json()
  check(
    'an invented TrxID is never approved',
    inventedBody.resolution?.startsWith('not_found'),
    inventedBody.resolution,
  )

  /* ── Split payment ────────────────────────────────────────────────────── */

  section('Split payment, reference skipped')

  const total = 90_000 + Math.floor(Math.random() * 20_000)
  const intent = await createIntent(total, { provider: 'bkash' })
  check('intent created', Boolean(intent.ref_code), JSON.stringify(intent))

  const msisdn = intent.receiving_account.msisdn
  const half = Math.floor(total / 2)

  // No reference, so nothing auto-matches and the TrxID is the way through.
  const trx1 = trxId()
  await capture(msisdn, bkashMessage({ taka: half / 100, trx: trx1 }))
  const sub1 = await (await pay(intent.id, '/submit', { trx_id: trx1 })).json()
  check(
    'first instalment is underpaid, not rejected',
    sub1.resolution === 'underpaid',
    sub1.resolution,
  )
  check('it reports the shortfall', sub1.shortfall === total - half, String(sub1.shortfall))
  check('and repeats the same reference for the top-up', sub1.top_up?.ref_code === intent.ref_code)

  const mid = await (await pay(intent.id, '/status')).json()
  check('status is partial', mid.status === 'partial', mid.status)
  check(
    'received so far is the first instalment',
    mid.received_amount === half,
    String(mid.received_amount),
  )
  check('one payment is listed', mid.payments?.length === 1, JSON.stringify(mid.payments))

  // Second instalment clears the rest.
  // The remainder *does* carry the reference, so it needs no help.
  const trx2 = trxId()
  await capture(
    msisdn,
    bkashMessage({ taka: (total - half) / 100, ref: intent.ref_code, trx: trx2 }),
  )
  const done = await (await pay(intent.id, '/status')).json()
  check('the remainder matches automatically', done.status === 'matched', done.status)
  check('nothing outstanding', done.shortfall === 0, String(done.shortfall))
  check(
    'both payments are linked to the one intent',
    done.payments?.length === 2,
    JSON.stringify(done.payments),
  )
  check(
    'and they add up to the full amount',
    done.payments?.reduce((sum, p) => sum + p.amount, 0) === total,
  )

  /* ── Automatic partial ────────────────────────────────────────────────── */

  section('Partial paid with the reference — no manual step')

  const autoTotal = 70_000 + Math.floor(Math.random() * 20_000)
  const autoIntent = await createIntent(autoTotal, { provider: 'bkash' })
  const autoMsisdn = autoIntent.receiving_account.msisdn
  const firstPart = Math.floor(autoTotal / 3)

  await capture(
    autoMsisdn,
    bkashMessage({ taka: firstPart / 100, ref: autoIntent.ref_code, trx: trxId() }),
  )
  const afterFirst = await (await pay(autoIntent.id, '/status')).json()
  check(
    'a short payment with the code verifies itself',
    afterFirst.status === 'partial',
    afterFirst.status,
  )
  check(
    'and is counted',
    afterFirst.received_amount === firstPart,
    String(afterFirst.received_amount),
  )
  check(
    'with the rest still outstanding',
    afterFirst.shortfall === autoTotal - firstPart,
    String(afterFirst.shortfall),
  )

  // A second instalment, also short, also with the code.
  const secondPart = Math.floor((autoTotal - firstPart) / 2)
  await capture(
    autoMsisdn,
    bkashMessage({ taka: secondPart / 100, ref: autoIntent.ref_code, trx: trxId() }),
  )
  const afterSecond = await (await pay(autoIntent.id, '/status')).json()
  check('a second short payment also verifies itself', afterSecond.payments?.length === 2)
  check(
    'the running balance is right',
    afterSecond.received_amount === firstPart + secondPart,
    String(afterSecond.received_amount),
  )

  // The remainder closes it.
  await capture(
    autoMsisdn,
    bkashMessage({
      taka: (autoTotal - firstPart - secondPart) / 100,
      ref: autoIntent.ref_code,
      trx: trxId(),
    }),
  )
  const closed = await (await pay(autoIntent.id, '/status')).json()
  check('the third closes the order', closed.status === 'matched', closed.status)
  check('three instalments are linked to it', closed.payments?.length === 3)

  /* ── A skipped reference still needs the manual path ──────────────────── */

  section('Reference skipped')

  const noRefTotal = 45_000 + Math.floor(Math.random() * 20_000)
  const noRef = await createIntent(noRefTotal, { provider: 'bkash' })
  const noRefTrx = trxId()

  // Short, and no reference at all — exactly the case that must not auto-match.
  await capture(
    noRef.receiving_account.msisdn,
    `You have received Tk ${(Math.floor(noRefTotal / 2) / 100).toFixed(2)} from 01712345678. ` +
      `Fee Tk 0.00. Balance Tk 45,320.00. TrxID ${noRefTrx} at 04/09/2026 19:00`,
  )
  const stillOpen = await (await pay(noRef.id, '/status')).json()
  check('it does not auto-match', stillOpen.status === 'open', stillOpen.status)
  check(
    'and nothing is counted',
    stillOpen.received_amount === 0,
    String(stillOpen.received_amount),
  )

  const rescued = await (await pay(noRef.id, '/submit', { trx_id: noRefTrx })).json()
  check('the TrxID rescues it as underpaid', rescued.resolution === 'underpaid', rescued.resolution)
  check('and it says how much is left', rescued.shortfall > 0, String(rescued.shortfall))

  /* ── Overpayment ──────────────────────────────────────────────────────── */

  section('Overpayment')

  const overTotal = 40_000 + Math.floor(Math.random() * 20_000)
  const overIntent = await createIntent(overTotal, { provider: 'bkash' })
  const overTrx = trxId()
  // Reference skipped again, so the submission is what resolves it.
  await capture(
    overIntent.receiving_account.msisdn,
    bkashMessage({ taka: (overTotal + 5_000) / 100, trx: overTrx }),
  )
  const overSub = await (await pay(overIntent.id, '/submit', { trx_id: overTrx })).json()
  check(
    'paying too much still completes the order',
    overSub.resolution === 'overpaid',
    overSub.resolution,
  )
  const overStatus = await (await pay(overIntent.id, '/status')).json()
  check('and the intent is matched', overStatus.status === 'matched', overStatus.status)

  /* ── Locked method ────────────────────────────────────────────────────── */

  section('A store that named the method')

  const locked = await createIntent(30_000 + Math.floor(Math.random() * 10_000), {
    provider: 'bkash',
  })
  const attempt = await pay(locked.id, '/method', { provider: 'nagad' })
  check('the buyer cannot overrule it', attempt.status === 409, `got ${attempt.status}`)

  console.log(`\n${passed} passed, ${failed} failed`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
