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
const [apiKey, deviceToken, deviceId, deviceToken2, deviceId2] = process.argv.slice(2)

if (!apiKey || !deviceToken || !deviceId) {
  console.error(
    'Usage: node scripts/smoke.mjs <api_key> <device_token> <device_id> [<device_token_2> <device_id_2>]',
  )
  console.error('Run `pnpm db:seed` to mint a set. Pass the second device to test failover.')
  process.exit(2)
}

/** Failover needs two accounts, so that section is skipped without a second device. */
const hasSecondDevice = Boolean(deviceToken2 && deviceId2)

let passed = 0
let failed = 0

/**
 * A bKash-style timestamp for *now*, in the dd/mm/yyyy the parser expects.
 *
 * Not hardcoded. The matcher requires a payment to have happened between the
 * buyer starting checkout and the intent expiring, read from the timestamp in
 * the message — so a fixed date in a fixture stops matching the moment the
 * calendar moves past it.
 */
function bkashStamp(offsetMinutes = 0) {
  const at = new Date(Date.now() + offsetMinutes * 60_000)
  const pad = (n) => String(n).padStart(2, '0')
  return (
    `${pad(at.getDate())}/${pad(at.getMonth() + 1)}/${at.getFullYear()} ` +
    `${pad(at.getHours())}:${pad(at.getMinutes())}`
  )
}

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

const deviceB = hasSecondDevice
  ? (method, path, body) =>
      call(method, path, body, {
        authorization: `Bearer ${deviceToken2}`,
        'x-device-id': deviceId2,
      })
  : null

/*
 * Which device belongs to which account.
 *
 * `/v1/accounts` deliberately exposes no device ids, so beat one device at a
 * time and watch which account's `last_heartbeat_at` moves. Everything after
 * this needs the mapping: a capture sent from the wrong device lands on the
 * wrong account and correctly refuses to match, which looks like a matcher bug
 * and is not one.
 */
let deviceAMsisdn = null
let deviceBMsisdn = null

if (deviceB) {
  await deviceB('POST', '/device/v1/heartbeat', {
    battery: 90,
    charging: true,
    network: 'wifi',
    queue_depth: 0,
    permissions: { notification_listener: true, sms: true },
    app_version: '1.4.0',
  })
  await new Promise((resolve) => setTimeout(resolve, 1100))
  await device('POST', '/device/v1/heartbeat', { queue_depth: 0 })

  const beats = await client('GET', '/v1/accounts')
  const newest = [...(beats.json.accounts ?? [])].sort(
    (a, b) => Date.parse(b.health.last_heartbeat_at) - Date.parse(a.health.last_heartbeat_at),
  )
  deviceAMsisdn = newest[0]?.msisdn ?? null
  deviceBMsisdn = newest[1]?.msisdn ?? null
  check('device-to-account mapping resolved', Boolean(deviceAMsisdn && deviceBMsisdn))
}

/** The device that can actually capture for a given receiving number. */
function deviceFor(msisdn) {
  if (!deviceB) return device
  return msisdn === deviceBMsisdn ? deviceB : device
}

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
const refCode = created.json.ref_code
check('ref code is 8 chars', created.json.ref_code?.length === 8, created.json.ref_code)
check(
  'and uses no ambiguous characters',
  /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/.test(created.json.ref_code ?? ''),
  created.json.ref_code,
)
check('request_id present', Boolean(created.json.request_id))
check('rate limit headers present', created.headers.get('x-ratelimit-limit') !== null)

const intentId = created.json.id

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
// Two buyers owing the same amount is ordinary, not a conflict. There used to
// be an exclusive claim on (account, amount) and it meant the third customer to
// buy a given item could not check out at all.
check(
  'a second buyer at the same amount is fine',
  collision.status === 201,
  `got ${collision.status}`,
)
check(
  'and gets their own reference code',
  collision.json.ref_code && collision.json.ref_code !== created.json.ref_code,
  `${created.json.ref_code} vs ${collision.json.ref_code}`,
)

/*
 * The second intent for section 5, allocated here rather than there.
 *
 * Section 5 needs an intent on the *same* account as the one whose TrxID it is
 * about to try to reuse, because submissions are scoped to the intent's own
 * account and one that routed elsewhere reports the TrxID as merely not found —
 * correct, but it never reaches the reuse guard.
 *
 * It used to ask for that after the capture had already landed, which cannot
 * work: routing picks the least-utilised account, and that account had just
 * received the payment, so it was now the *most* utilised of the two. Eight
 * retries could not change a deterministic answer. The check had been failing
 * for anyone with more than one account ever since routing started balancing,
 * and the run then threw on the null and reported fewer failures than it had.
 *
 * Asked before any money has moved, the two accounts are level and the random
 * tiebreak makes retrying meaningful.
 */
const spentOn = created.json.receiving_account?.msisdn

async function intentOnSameAccount() {
  for (let attempt = 0; attempt < 8; attempt++) {
    const candidate = await client(
      'POST',
      '/v1/intents',
      {
        amount: amount + 7 + attempt,
        client_reference: `ORD-SUB-${nonce}-${attempt}`,
        provider: created.json.receiving_account?.provider,
        payer_msisdn: '01712345678',
      },
      { 'idempotency-key': `smoke-sub-${nonce}-${attempt}` },
    )
    if (candidate.json.receiving_account?.msisdn === spentOn) return candidate
  }
  return null
}

const fresh = await intentOnSameAccount()

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

const captureDevice = deviceFor(created.json.receiving_account?.msisdn)
const capture = await captureDevice('POST', '/device/v1/capture', {
  captures: [
    {
      local_id: 'c_smoke_1',
      source: 'notification',
      package: 'com.bKash.customerapp',
      raw: `You have received Tk ${taka} from 01712345678. Ref ${refCode}. Fee Tk 0.00. TrxID ${trxId} at ${bkashStamp()}`,
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

const duplicate = await captureDevice('POST', '/device/v1/capture', {
  captures: [
    {
      local_id: 'c_smoke_1_sms',
      source: 'sms',
      raw: `You have received Tk ${taka} from 01712345678. Ref ${refCode}. Fee Tk 0.00. TrxID ${trxId} at ${bkashStamp()}`,
      captured_at: new Date().toISOString(),
    },
  ],
})
check('dual capture deduplicates', duplicate.json.results?.[0]?.status === 'duplicate')

const unparsed = await captureDevice('POST', '/device/v1/capture', {
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
/*
 * What happens to it depends on the account's capture settings, so ask.
 *
 * This used to assert `unparsed` flatly, and had been failing since captures
 * started being filtered against what the account said it wanted to keep. An
 * unrecognised bKash notification is "other", and `other` is off by default, so
 * the honest answer is `filtered` on a fresh seed and `unparsed` once somebody
 * turns it on. Asserting one of them unconditionally means the check is wrong
 * in one of the two configurations, and this one had been wrong — and ignored —
 * for long enough that nobody read the output any more.
 */
const settings = await captureDevice('GET', '/device/v1/settings')
const keepsOther = settings.json.capture?.other === true
const junkStatus = unparsed.json.results?.[0]?.status

check(
  keepsOther
    ? 'unparseable message is stored, not dropped'
    : 'unparseable message is filtered, because this account keeps no "other"',
  junkStatus === (keepsOther ? 'unparsed' : 'filtered'),
  `got ${junkStatus} with other=${keepsOther}`,
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

check(
  'a second intent was placed on the same receiving account',
  fresh !== null,
  `never routed back to ${spentOn} in 8 attempts`,
)

if (fresh === null) {
  // Sections 5 and 6 both dereference it. Running on would throw on the first
  // use and report fewer failures than there are, which is how the previous
  // version of this hid the rest of the suite.
  console.log('\n  Stopping: the next two sections need that intent.')
  console.log(`\n${passed} passed, ${failed} failed`)
  process.exit(1)
}

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
await deviceFor(fresh.json.receiving_account?.msisdn)('POST', '/device/v1/capture', {
  captures: [
    {
      local_id: 'c_smoke_short',
      source: 'notification',
      package: 'com.bKash.customerapp',
      raw: `You have received Tk ${(shortAmount / 100).toFixed(2)} from 01712345678. Fee Tk 0.00. TrxID ${shortTrx} at ${bkashStamp()}`,
      captured_at: new Date().toISOString(),
    },
  ],
})

// From the number the intent declared. A payment from anywhere else is now
// escalated to a human rather than credited, which is a different test.
const underpaid = await client('POST', '/v1/submissions', {
  intent_id: fresh.json.id,
  trx_id: shortTrx,
  sender_msisdn: '8801712345678',
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

/* ── 8. Two-account routing and failover ──────────────────────────────────── */

if (hasSecondDevice) {
  section('Failover')

  // Device-to-account mapping was resolved in section 1.

  const foAmount = 500_000 + (Date.now() % 90_000)

  const first = await client(
    'POST',
    '/v1/intents',
    { amount: foAmount, client_reference: `FO-1-${nonce}` },
    { 'idempotency-key': `fo-1-${nonce}` },
  )
  const second = await client(
    'POST',
    '/v1/intents',
    { amount: foAmount, client_reference: `FO-2-${nonce}` },
    { 'idempotency-key': `fo-2-${nonce}` },
  )

  check('first intent created', first.status === 201, `got ${first.status}`)
  check('a second at the same amount is fine', second.status === 201, `got ${second.status}`)

  /*
   * Concurrency at one price is no longer capped by the number of accounts.
   * With the amount claim gone, ten buyers can want the same item at once.
   */
  const rest = await Promise.all(
    [3, 4, 5, 6, 7, 8, 9, 10].map((n) =>
      client(
        'POST',
        '/v1/intents',
        { amount: foAmount, client_reference: `FO-${n}-${nonce}` },
        { 'idempotency-key': `fo-${n}-${nonce}` },
      ),
    ),
  )
  check(
    'and so are eight more',
    rest.every((r) => r.status === 201),
    rest.map((r) => r.status).join(','),
  )
  check(
    'every one of them got a distinct reference code',
    new Set([first, second, ...rest].map((r) => r.json.ref_code)).size === rest.length + 2,
  )

  // A capture on the wrong account must not match, however perfect it looks.
  // The receiving account is a gate exactly like the amount is.
  const wrongAccountTrx = `BK${nonce}WRONGACC`
  // Capture from the device that does *not* own the first intent's account.
  const senderOnOtherAccount =
    first.json.receiving_account?.msisdn === deviceAMsisdn ? deviceB : device

  await senderOnOtherAccount('POST', '/device/v1/capture', {
    captures: [
      {
        local_id: 'c_wrong_account',
        source: 'notification',
        package: 'com.bKash.customerapp',
        raw: `You have received Tk ${(foAmount / 100).toFixed(2)} from 01712345678. Ref ${first.json.ref_code}. Fee Tk 0.00. TrxID ${wrongAccountTrx} at ${bkashStamp()}`,
        captured_at: new Date().toISOString(),
      },
    ],
  })

  const stillOpen = await client('GET', `/v1/intents/${first.json.id}`)
  check(
    'exact reference on the wrong account does not match',
    stillOpen.json.status === 'open',
    stillOpen.json.status,
  )
}

/* ── 9. Balance continuity ────────────────────────────────────────────────── */

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
      raw: `You have received Tk 10.00 from 01711111111. Fee Tk 0.00. Balance Tk 987,654.00. TrxID ${driftTrx} at ${bkashStamp()}`,
      captured_at: new Date().toISOString(),
    },
  ],
})
check('a drifting capture is still accepted', drifted.json.results?.[0]?.status === 'accepted')

const afterDrift = await client('GET', '/v1/accounts')
const drifting = afterDrift.json.accounts?.find((a) => a.health?.balance_drift === true)
check('drift is reported to clients', Boolean(drifting), JSON.stringify(afterDrift.json.accounts))
check('the drifting account is degraded', drifting?.status === 'degraded', drifting?.status)

const healthyRemaining = (afterDrift.json.accounts ?? []).filter(
  (a) => a.status === 'active' && !a.health?.balance_drift,
)

const afterwards = await client(
  'POST',
  '/v1/intents',
  { amount: 700_000 + (Date.now() % 90_000), client_reference: `ORD-AFTER-DRIFT-${nonce}` },
  { 'idempotency-key': `smoke-drift-${nonce}` },
)

if (healthyRemaining.length > 0) {
  /*
   * With a second account still healthy, a drifting account must NOT stop
   * checkout — it must route around it. That is the entire reason two accounts
   * are described as non-optional.
   */
  check(
    'checkout routes around the drifting account',
    afterwards.status === 201,
    `got ${afterwards.status}`,
  )
  check(
    'and lands on a healthy one',
    afterwards.json.receiving_account?.msisdn !== drifting?.msisdn,
    afterwards.json.receiving_account?.msisdn,
  )
} else {
  // Single-account deployment: nothing to fail over to, so the client must not
  // be shown a pay page at all.
  check(
    'no pay page when the only account is drifting',
    afterwards.status === 503,
    `got ${afterwards.status}`,
  )
  check('with code no_healthy_account', afterwards.json.error?.code === 'no_healthy_account')
}

console.log('\n  note: this section intentionally degrades an account.')
console.log('        run `pnpm db:seed` to re-anchor its balance before the next run.')

/* ── Summary ──────────────────────────────────────────────────────────────── */

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed === 0 ? 0 : 1)
