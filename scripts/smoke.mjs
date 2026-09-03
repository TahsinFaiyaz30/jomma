#!/usr/bin/env node
/**
 * End-to-end smoke test against a running dev server.
 *
 *   pnpm db:up && pnpm db:migrate && pnpm db:seed   # note the printed credentials
 *   pnpm dev                                        # in another terminal
 *   node scripts/smoke.mjs <api_key> <device_token> <device_id>
 *
 * Drives the real HTTP surface, not the service layer, so it exercises auth,
 * validation, rate-limit headers, and the rewrites as well as the business
 * logic. Exits non-zero on the first failed assertion.
 */

const BASE = process.env.JOMMA_URL ?? 'http://localhost:3000'
const [apiKey, deviceToken, deviceId] = process.argv.slice(2)

if (!apiKey || !deviceToken || !deviceId) {
  console.error('Usage: node scripts/smoke.mjs <api_key> <device_token> <device_id>')
  console.error('Run `pnpm db:seed` to mint a set.')
  process.exit(2)
}

let passed = 0
let failed = 0

function check(label, condition, detail = '') {
  if (condition) {
    passed++
    console.log(`  ok    ${label}`)
  } else {
    failed++
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

function section(title) {
  console.log(`\n${title}`)
}

async function call(method, path, body, headers = {}) {
  const response = await fetch(BASE + path, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await response.text()
  let json
  try {
    json = JSON.parse(text)
  } catch {
    json = { raw: text }
  }
  return { status: response.status, json, headers: response.headers }
}

const client = (method, path, body, extra = {}) =>
  call(method, path, body, { authorization: `Bearer ${apiKey}`, ...extra })

const device = (method, path, body) =>
  call(method, path, body, {
    authorization: `Bearer ${deviceToken}`,
    'x-device-id': deviceId,
  })

const nonce = Date.now().toString(36).toUpperCase().slice(-5)
const amount = 100_000 + (Date.now() % 90_000)

/* ── 1. Device heartbeat ──────────────────────────────────────────────────── */

section('Device')

const heartbeat = await device('POST', '/device/v1/heartbeat', {
  battery: 87,
  charging: true,
  network: 'wifi',
  queue_depth: 0,
  permissions: { notification_listener: true, sms: true },
  app_version: '1.4.0',
})
check('heartbeat accepted', heartbeat.status === 200, `got ${heartbeat.status}`)
check('commands array returned', Array.isArray(heartbeat.json.commands))
check('server_time returned', Boolean(heartbeat.json.server_time))

const event = await device('POST', '/device/v1/events', {
  kind: 'service_restarted',
  detail: 'smoke test',
})
check('event accepted', event.status === 200)

/* ── 2. Intent lifecycle ──────────────────────────────────────────────────── */

section('Intent lifecycle')

const created = await client(
  'POST',
  '/v1/intents',
  {
    amount,
    client_reference: `ORD-SMOKE-${nonce}`,
    payer_msisdn: '8801712345678',
    ttl_seconds: 600,
    metadata: { store_id: 'st_912' },
  },
  { 'idempotency-key': `smoke-${nonce}` },
)

check('create returns 201', created.status === 201, `got ${created.status}`)
check('id is prefixed', created.json.id?.startsWith('int_'), created.json.id)
check('ref code is 4 chars', created.json.ref_code?.length === 4, created.json.ref_code)
check('request_id present', Boolean(created.json.request_id))
check('rate limit headers present', created.headers.get('x-ratelimit-limit') !== null)

const intentId = created.json.id
const refCode = created.json.ref_code

const replayed = await client(
  'POST',
  '/v1/intents',
  {
    amount,
    client_reference: `ORD-SMOKE-${nonce}`,
    payer_msisdn: '8801712345678',
    ttl_seconds: 600,
    metadata: { store_id: 'st_912' },
  },
  { 'idempotency-key': `smoke-${nonce}` },
)
check('idempotent replay returns the original', replayed.json.id === intentId)
check('replay does not allocate a second code', replayed.json.ref_code === refCode)

const collision = await client(
  'POST',
  '/v1/intents',
  { amount, client_reference: 'ORD-COLLIDE' },
  { 'idempotency-key': `smoke-collide-${nonce}` },
)
check('same amount on the only account is 409', collision.status === 409, `got ${collision.status}`)
check('with code no_capacity', collision.json.error?.code === 'no_capacity')

/* ── 3. Auth and validation ───────────────────────────────────────────────── */

section('Auth and validation')

const noAuth = await call('GET', `/v1/intents/${intentId}`)
check('missing key is 401', noAuth.status === 401)

const badAuth = await call('GET', `/v1/intents/${intentId}`, undefined, {
  authorization: 'Bearer jm_live_000000000000000000000000000000000',
})
check('bad key is 401', badAuth.status === 401)
check('error carries request_id', Boolean(badAuth.json.error?.request_id))

const invalid = await client('POST', '/v1/intents', {
  amount: 0,
  client_reference: '',
})
check('zero amount is 422', invalid.status === 422)
check('validation details included', Array.isArray(invalid.json.error?.details))

const deviceWrongToken = await call(
  'POST',
  '/device/v1/heartbeat',
  {},
  {
    authorization: `Bearer ${apiKey}`,
    'x-device-id': deviceId,
  },
)
check('api key cannot authenticate as a device', deviceWrongToken.status === 401)

/* ── 4. Capture and automatic matching ────────────────────────────────────── */

section('Capture and matching')

const taka = (amount / 100).toFixed(2)
const trxId = `BK${nonce}${Math.floor(Math.random() * 9000 + 1000)}`

// These captures deliberately omit `Balance Tk`. That is the documented
// "partial" parse path — the payment still matches, and the balance continuity
// check has nothing to compare, so a repeated run does not accumulate drift.
// Section 8 exercises the continuity check on its own.

const capture = await device('POST', '/device/v1/capture', {
  captures: [
    {
      local_id: 'c_smoke_1',
      source: 'notification',
      package: 'com.bKash.customerapp',
      raw: `You have received Tk ${taka} from 01712345678. Ref ${refCode}. Fee Tk 0.00. TrxID ${trxId} at 03/09/2026 14:35`,
      captured_at: new Date().toISOString(),
    },
  ],
})

check('capture accepted', capture.status === 200, `got ${capture.status}`)
check(
  'status is accepted',
  capture.json.results?.[0]?.status === 'accepted',
  JSON.stringify(capture.json.results),
)
check('trx_id echoed back', capture.json.results?.[0]?.trx_id === trxId)

const duplicate = await device('POST', '/device/v1/capture', {
  captures: [
    {
      local_id: 'c_smoke_1_sms',
      source: 'sms',
      raw: `You have received Tk ${taka} from 01712345678. Ref ${refCode}. Fee Tk 0.00. TrxID ${trxId} at 03/09/2026 14:35`,
      captured_at: new Date().toISOString(),
    },
  ],
})
check('dual capture deduplicates', duplicate.json.results?.[0]?.status === 'duplicate')

const unparsed = await device('POST', '/device/v1/capture', {
  captures: [
    {
      local_id: 'c_smoke_junk',
      source: 'notification',
      package: 'com.bKash.customerapp',
      raw: 'bKash: something entirely new that no parser has seen',
      captured_at: new Date().toISOString(),
    },
  ],
})
check(
  'unparseable message is stored, not dropped',
  unparsed.json.results?.[0]?.status === 'unparsed',
)

const afterMatch = await client('GET', `/v1/intents/${intentId}`)
check('intent is matched', afterMatch.json.status === 'matched', `got ${afterMatch.json.status}`)
check('received amount is exact', afterMatch.json.received_amount === amount)
check('shortfall is zero', afterMatch.json.shortfall === 0)
check('payment is attached', afterMatch.json.payments?.length === 1)
check('confidence is exact', afterMatch.json.payments?.[0]?.match_confidence === 'exact')
check('matched automatically', afterMatch.json.payments?.[0]?.matched_by === 'automatic')

/* ── 5. Submissions ───────────────────────────────────────────────────────── */

section('Submissions')

const already = await client('POST', '/v1/submissions', {
  intent_id: intentId,
  trx_id: trxId,
  sender_msisdn: '8801712345678',
})
check(
  'resubmitting an applied TrxID is idempotent',
  already.json.resolution === 'exact',
  JSON.stringify(already.json),
)

const fresh = await client(
  'POST',
  '/v1/intents',
  { amount: amount + 7, client_reference: `ORD-SUB-${nonce}` },
  { 'idempotency-key': `smoke-sub-${nonce}` },
)

const stolen = await client('POST', '/v1/submissions', {
  intent_id: fresh.json.id,
  trx_id: trxId,
  sender_msisdn: '8801712345678',
})
check(
  'a spent TrxID cannot be reused',
  stolen.json.resolution === 'already_used',
  JSON.stringify(stolen.json),
)
check('the other intent is untouched', stolen.json.intent_status === 'open')

const invented = await client('POST', '/v1/submissions', {
  intent_id: fresh.json.id,
  trx_id: 'BKINVENTED999',
  sender_msisdn: '8801712345678',
})
check(
  'an invented TrxID is never approved',
  invented.json.resolution === 'not_found_recent',
  JSON.stringify(invented.json),
)

/* ── 6. Underpayment ──────────────────────────────────────────────────────── */

section('Underpayment')

const shortAmount = fresh.json.amount - 20_000
const shortTrx = `BK${nonce}SHORT`
await device('POST', '/device/v1/capture', {
  captures: [
    {
      local_id: 'c_smoke_short',
      source: 'notification',
      package: 'com.bKash.customerapp',
      raw: `You have received Tk ${(shortAmount / 100).toFixed(2)} from 01799999999. Fee Tk 0.00. TrxID ${shortTrx} at 03/09/2026 14:40`,
      captured_at: new Date().toISOString(),
    },
  ],
})

const underpaid = await client('POST', '/v1/submissions', {
  intent_id: fresh.json.id,
  trx_id: shortTrx,
  sender_msisdn: '8801799999999',
})
check(
  'underpaid resolution',
  underpaid.json.resolution === 'underpaid',
  JSON.stringify(underpaid.json),
)
check('intent goes partial', underpaid.json.intent_status === 'partial')
check(
  'shortfall is reported',
  underpaid.json.shortfall === 20_000,
  String(underpaid.json.shortfall),
)
check('top-up instructions included', Boolean(underpaid.json.top_up?.receiving_msisdn))
check('top-up reuses the same reference', underpaid.json.top_up?.ref_code === fresh.json.ref_code)

/* ── 7. Accounts ──────────────────────────────────────────────────────────── */

section('Accounts')

const accounts = await client('GET', '/v1/accounts')
check('accounts listed', Array.isArray(accounts.json.accounts) && accounts.json.accounts.length > 0)
check('limits reported', typeof accounts.json.accounts?.[0]?.limits?.utilization === 'number')
check('no device ids leaked to clients', !JSON.stringify(accounts.json).includes('device'))

/* ── 8. Balance continuity ────────────────────────────────────────────────── */

section('Balance continuity')

// A balance that cannot follow from the anchor is the signature of a payment the
// notifier never saw — the failure this whole product exists to catch.
const driftTrx = `BK${nonce}DRIFT`
const drifted = await device('POST', '/device/v1/capture', {
  captures: [
    {
      local_id: 'c_smoke_drift',
      source: 'notification',
      package: 'com.bKash.customerapp',
      raw: `You have received Tk 10.00 from 01711111111. Fee Tk 0.00. Balance Tk 987,654.00. TrxID ${driftTrx} at 03/09/2026 16:00`,
      captured_at: new Date().toISOString(),
    },
  ],
})
check('a drifting capture is still accepted', drifted.json.results?.[0]?.status === 'accepted')

const afterDrift = await client('GET', '/v1/accounts')
const account = afterDrift.json.accounts?.[0]
check(
  'drift is reported to clients',
  account?.health?.balance_drift === true,
  JSON.stringify(account?.health),
)
check('account stops being routable', account?.status === 'degraded', account?.status)

const blocked = await client(
  'POST',
  '/v1/intents',
  { amount: 12_345, client_reference: 'ORD-AFTER-DRIFT' },
  { 'idempotency-key': `smoke-drift-${nonce}` },
)
check('no pay page while an account is drifting', blocked.status === 503, `got ${blocked.status}`)
check('with code no_healthy_account', blocked.json.error?.code === 'no_healthy_account')

console.log('\n  note: this section intentionally degrades the account.')
console.log('        run `pnpm db:seed` to re-anchor its balance before the next run.')

/* ── Summary ──────────────────────────────────────────────────────────────── */

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed === 0 ? 0 : 1)
