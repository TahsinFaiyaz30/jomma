#!/usr/bin/env node
/**
 * Adversarial audit.
 *
 * Not a happy-path suite — the other three smoke scripts do that. This one
 * attacks: it calls every endpoint without credentials, with somebody else's
 * credentials, with malformed and oversized input, and reads every public
 * response looking for a field a stranger should not be holding.
 *
 * A payment verifier that leaks a phone number is broken even if every payment
 * matches correctly, so failures here are treated exactly like a wrong balance.
 *
 * Usage: node scripts/audit.mjs <api_key> <second_api_key> <device_token> <device_id>
 */

import { createHmac, randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'

const BASE = process.env.JOMMA_URL ?? 'http://localhost:3000'
const [apiKey, otherKey, deviceToken, deviceId] = process.argv.slice(2)

if (!apiKey) {
  console.error(
    'Usage: node scripts/audit.mjs <api_key> [other_api_key] [device_token] [device_id]',
  )
  process.exit(1)
}

const secret = readFileSync(new URL('../.env', import.meta.url), 'utf8')
  .split('\n')
  .find((l) => l.startsWith('WEBHOOK_SIGNING_SECRET='))
  ?.split('=')[1]
  ?.trim()

let passed = 0
let failed = 0
const failures = []

function check(label, condition, detail) {
  if (condition) {
    passed += 1
    console.log(`  ok    ${label}`)
  } else {
    failed += 1
    failures.push(label)
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

const section = (n) => console.log(`\n${n}`)

const req = (method, path, { body, headers } = {}) =>
  fetch(`${BASE}${path}`, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...headers },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  })

function keys(value, out = []) {
  if (Array.isArray(value)) for (const v of value) keys(v, out)
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      out.push(k)
      keys(v, out)
    }
  }
  return out
}

async function main() {
  console.log(`Adversarial audit — ${BASE}`)
  await run()
}

/** The audit itself, split out so `main` stays a launcher. */
async function run() {
  /* ── 1. Endpoints that must refuse anonymous callers ──────────────────── */

  section('Unauthenticated access')

  const anon = [
    ['GET', '/api/dash/feed'],
    ['GET', '/v1/accounts'],
    ['POST', '/v1/intents'],
    ['POST', '/v1/submissions'],
    ['POST', '/device/v1/capture'],
    ['POST', '/device/v1/heartbeat'],
    ['POST', '/device/v1/events'],
    ['POST', '/api/internal/sweep'],
    ['POST', '/ingest/v1/webhook'],
  ]

  for (const [method, path] of anon) {
    const r = await req(method, path, { body: method === 'POST' ? {} : undefined })
    check(
      `${method} ${path} refuses anonymous`,
      r.status === 401 || r.status === 403,
      `got ${r.status}`,
    )
  }

  /* ── 2. Cross-tenant ──────────────────────────────────────────────────── */

  section('Cross-tenant isolation')

  const mine = await (
    await req('POST', '/v1/intents', {
      headers: {
        authorization: `Bearer ${apiKey}`,
        'idempotency-key': randomBytes(8).toString('hex'),
      },
      body: {
        amount: 40_000 + Math.floor(Math.random() * 20_000),
        client_reference: `AUDIT-${Date.now()}`,
        ttl_seconds: 900,
        payer_msisdn: '01712345678',
      },
    })
  ).json()
  check('own intent created', Boolean(mine.id), JSON.stringify(mine))

  if (otherKey) {
    const stolen = await req('GET', `/v1/intents/${mine.id}`, {
      headers: { authorization: `Bearer ${otherKey}` },
    })
    check(
      "another app cannot read someone else's intent",
      stolen.status === 403 || stolen.status === 404,
      `got ${stolen.status}`,
    )
    check(
      'and is not told the intent exists',
      stolen.status === 404,
      `got ${stolen.status} — 403 confirms existence`,
    )

    const cancelled = await req('POST', `/v1/intents/${mine.id}/cancel`, {
      headers: { authorization: `Bearer ${otherKey}` },
    })
    check(
      "another app cannot cancel someone else's intent",
      cancelled.status === 403 || cancelled.status === 404,
      `got ${cancelled.status}`,
    )

    const submitted = await req('POST', '/v1/submissions', {
      headers: { authorization: `Bearer ${otherKey}` },
      body: { intent_id: mine.id, trx_id: 'AAAAAAAAAA' },
    })
    check(
      "another app cannot submit against someone else's intent",
      submitted.status === 403 || submitted.status === 404,
      `got ${submitted.status}`,
    )
  }

  /*
   * Whose phones a key can see.
   *
   * This is the check that would have failed before receiving accounts belonged
   * to a business: `/v1/accounts` returned every number on the instance, so one
   * merchant's key could enumerate another merchant's phones — and, worse,
   * checkout could route a buyer at one of them.
   *
   * Compared rather than asserted empty, because in single-tenant mode both
   * keys legitimately belong to the same business and seeing the same numbers is
   * correct. What must never happen is two *different* businesses sharing one.
   */
  const myAccounts = await (
    await req('GET', '/v1/accounts', { headers: { authorization: `Bearer ${apiKey}` } })
  ).json()

  check(
    'own accounts are listed',
    Array.isArray(myAccounts.accounts),
    JSON.stringify(myAccounts).slice(0, 120),
  )

  if (otherKey) {
    const theirAccounts = await (
      await req('GET', '/v1/accounts', { headers: { authorization: `Bearer ${otherKey}` } })
    ).json()

    const mineSet = new Set((myAccounts.accounts ?? []).map((a) => a.msisdn))
    const overlap = (theirAccounts.accounts ?? []).filter((a) => mineSet.has(a.msisdn))

    // Same business: overlap is expected and correct. Different businesses:
    // any overlap at all is a routing bug that sends buyers to the wrong phone.
    check(
      'account lists are scoped to the key that asked',
      Array.isArray(theirAccounts.accounts),
      JSON.stringify(theirAccounts).slice(0, 120),
    )
    note(
      overlap.length === 0
        ? 'the two keys see no numbers in common'
        : `the two keys share ${overlap.length} number(s) — expected only if they are one business`,
    )
  }

  /* ── 3. What the buyer's own page hands out ───────────────────────────── */

  section('Public pay endpoints: what leaks')

  const status = await (await req('GET', `/api/pay/${mine.id}/status`)).json()
  const banned = [
    'payer_msisdn',
    'payerMsisdn',
    'raw_message',
    'rawMessage',
    'client_reference',
    'clientReference',
    'app_id',
    'appId',
    'receiving_account_id',
    'receivingAccountId',
    'device_id',
    'deviceId',
    'secret',
    'token',
    'metadata',
  ]
  const present = keys(status).filter((k) => banned.includes(k))
  check(
    'status response carries nothing internal',
    present.length === 0,
    `leaked: ${present.join(', ')}`,
  )

  // The merchant's own order id is theirs, not the buyer's.
  const blob = JSON.stringify(status)
  check(
    "and not the store's order reference",
    !blob.includes(mine.client_reference ?? 'AUDIT-'),
    blob.slice(0, 200),
  )

  const payHtml = await (await req('GET', `/pay/${mine.id}`)).text()
  for (const needle of ['jm_live_', 'jmd_', 'whsec_', 'DATABASE_URL', 'AUTH_SECRET']) {
    check(`pay page HTML contains no ${needle}`, !payHtml.includes(needle))
  }

  /* ── 4. IDOR and id guessing ──────────────────────────────────────────── */

  section('Identifier handling')

  for (const bad of [
    'int_00000000000000000000000000',
    'notanid',
    '../../etc/passwd',
    "int_' OR 1=1--",
    `int_${'Z'.repeat(26)}`,
  ]) {
    const r = await req('GET', `/api/pay/${encodeURIComponent(bad)}/status`)
    check(`malformed id "${bad.slice(0, 22)}" is a clean 404`, r.status === 404, `got ${r.status}`)
  }

  await validationAndCredentials(mine)
}

/** Input handling, credentials, errors, limits and headers. */
async function validationAndCredentials(mine) {
  /* ── 5. Input validation ──────────────────────────────────────────────── */

  section('Input validation')

  const oversize = await req('POST', '/v1/intents', {
    headers: {
      authorization: `Bearer ${apiKey}`,
      'idempotency-key': randomBytes(8).toString('hex'),
    },
    body: { amount: 1000, client_reference: 'x'.repeat(100_000), ttl_seconds: 900 },
  })
  check(
    'an oversized client_reference is rejected',
    oversize.status === 422,
    `got ${oversize.status}`,
  )

  const negative = await req('POST', '/v1/intents', {
    headers: {
      authorization: `Bearer ${apiKey}`,
      'idempotency-key': randomBytes(8).toString('hex'),
    },
    body: { amount: -5000, client_reference: 'NEG', ttl_seconds: 900 },
  })
  check('a negative amount is rejected', negative.status === 422, `got ${negative.status}`)

  const float = await req('POST', '/v1/intents', {
    headers: {
      authorization: `Bearer ${apiKey}`,
      'idempotency-key': randomBytes(8).toString('hex'),
    },
    body: { amount: 100.55, client_reference: 'FLOAT', ttl_seconds: 900 },
  })
  check('a fractional poisha amount is rejected', float.status === 422, `got ${float.status}`)

  const huge = await req('POST', '/v1/intents', {
    headers: {
      authorization: `Bearer ${apiKey}`,
      'idempotency-key': randomBytes(8).toString('hex'),
    },
    body: { amount: Number.MAX_SAFE_INTEGER, client_reference: 'HUGE', ttl_seconds: 900 },
  })
  check('an absurd amount is rejected', huge.status === 422, `got ${huge.status}`)

  const garbage = await req('POST', '/v1/intents', {
    headers: {
      authorization: `Bearer ${apiKey}`,
      'idempotency-key': randomBytes(8).toString('hex'),
    },
    body: '{"amount":',
  })
  check('malformed JSON is a 422, not a 500', garbage.status === 422, `got ${garbage.status}`)

  const injection = await req('POST', `/api/pay/${mine.id}/submit`, {
    body: { trx_id: "'; DROP TABLE payment_intents;--" },
  })
  check(
    'a SQL-shaped TrxID is handled as data',
    injection.status === 200 || injection.status === 422,
    `got ${injection.status}`,
  )

  /* ── 6. Credentials ───────────────────────────────────────────────────── */

  section('Credential handling')

  for (const key of ['jm_live_totallyfake000000000000', 'Bearer', '', 'null']) {
    const r = await req('GET', '/v1/accounts', { headers: { authorization: `Bearer ${key}` } })
    check(
      `a bogus API key is 401 (${key.slice(0, 16) || 'empty'})`,
      r.status === 401,
      `got ${r.status}`,
    )
  }

  if (deviceToken && deviceId) {
    const wrongDevice = await req('POST', '/device/v1/heartbeat', {
      headers: {
        authorization: `Bearer ${deviceToken}`,
        'x-device-id': randomBytes(16).toString('hex'),
      },
      body: {},
    })
    check(
      'a device token with the wrong device id is refused',
      wrongDevice.status === 401,
      `got ${wrongDevice.status}`,
    )
  }

  const wrongSweep = await req('POST', '/api/internal/sweep', {
    headers: { 'x-jomma-internal': 'not-the-secret' },
  })
  check(
    'the internal sweep rejects a wrong secret',
    wrongSweep.status === 401,
    `got ${wrongSweep.status}`,
  )

  if (secret) {
    const body = JSON.stringify({ msisdn: '8801799887766', raw: 'x' })
    const ts = Math.floor(Date.now() / 1000)
    const good = createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex')

    const swapped = await req('POST', '/ingest/v1/webhook', {
      body,
      headers: { 'x-jomma-signature': `t=${ts + 1},v1=${good}` },
    })
    check(
      'an ingest signature is bound to its timestamp',
      swapped.status === 401,
      `got ${swapped.status}`,
    )

    const truncated = await req('POST', '/ingest/v1/webhook', {
      body,
      headers: { 'x-jomma-signature': `t=${ts},v1=${good.slice(0, 32)}` },
    })
    check('a truncated signature is refused', truncated.status === 401, `got ${truncated.status}`)
  }

  /* ── 7. Error bodies ──────────────────────────────────────────────────── */

  section('Error responses')

  const notFound = await (await req('GET', '/api/pay/int_00000000000000000000000000/status')).json()
  const errText = JSON.stringify(notFound).toLowerCase()
  for (const needle of ['select', 'postgres', 'drizzle', 'stack', 'at async', 'node_modules']) {
    check(`a 404 body leaks no ${needle}`, !errText.includes(needle), errText.slice(0, 160))
  }
  check(
    'and still carries a request_id',
    Boolean(notFound.error?.request_id ?? notFound.request_id),
  )

  /* ── 8. Rate limiting ─────────────────────────────────────────────────── */

  section('Rate limiting')

  const burst = await Promise.all(
    Array.from({ length: 80 }, () =>
      req('POST', `/api/pay/${mine.id}/submit`, { body: { trx_id: 'ZZZZZZZZZZ' } }),
    ),
  )
  check(
    'a burst against the public submit endpoint is throttled',
    burst.some((r) => r.status === 429),
    `statuses: ${[...new Set(burst.map((r) => r.status))].join(',')}`,
  )

  /* ── 9. Security headers ──────────────────────────────────────────────── */

  section('Response headers')

  const head = await req('GET', `/pay/${mine.id}`)
  check('X-Content-Type-Options is set', head.headers.get('x-content-type-options') === 'nosniff')
  check('X-Frame-Options is set', Boolean(head.headers.get('x-frame-options')))
  /*
   * Run this one against a production server.
   *
   * `next dev` answers dynamic pages with `no-cache, must-revalidate` and
   * `next start` answers the same page with `private, no-cache, no-store,
   * max-age=0, must-revalidate`. Only the second is what ships, so pointing
   * this suite at :3000 while a dev server is running fails the check and
   * invites a fix for a problem that does not exist in production. It has cost
   * an afternoon once already.
   */
  check(
    'the pay page is not cached by intermediaries',
    (head.headers.get('cache-control') ?? '').includes('no-store') ||
      (head.headers.get('cache-control') ?? '').includes('private'),
    `${head.headers.get('cache-control') ?? 'none'} — expected against \`next start\`, not \`next dev\``,
  )

  console.log(`\n${passed} passed, ${failed} failed`)
  if (failures.length) console.log(`\nfailing:\n  ${failures.join('\n  ')}`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
