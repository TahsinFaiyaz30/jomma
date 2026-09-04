# Jomma API

Three surfaces: **Client API** (`/v1/*`), **Device API** (`/device/v1/*`), and
outbound **webhooks**. Dashboard routes are session-authenticated and internal.

All request and response bodies are JSON. All money is integer minor units
(poisha). All timestamps are ISO 8601 UTC.

---

## Authentication

### Client API

```
Authorization: Bearer jm_live_xxxxxxxxxxxxxxxxxxxx
```

Keys are Argon2-hashed at rest. The prefix (`jm_live_` / `jm_test_`) is stored in
clear for lookup and display. Plaintext is shown once at creation.

### Device API

```
Authorization: Bearer jmd_xxxxxxxxxxxxxxxxxxxx
X-Device-Id:   <uuid>
```

Device tokens are separate from API keys, scoped to one receiving account, and
individually revocable. A revoked device gets `401` and must be re-provisioned by
QR from the dashboard.

---

## Client API

### `POST /v1/intents`

Create a payment request. This allocates a reference code and an amount lock.

```jsonc
// Request
{
  "amount": 120000,                    // poisha. ৳1,200.00
  "client_reference": "ORD-2026-001043",
  "payer_msisdn": "8801712345678",     // optional, boosts match confidence
  "provider": "bkash",                 // bkash | nagad | any
  "ttl_seconds": 300,                  // default 300, max 3600
  "metadata": { "store_id": "st_912" } // opaque, returned on webhooks
}
```

Send an `Idempotency-Key` header. Replaying the same key within 24h returns the
original intent rather than allocating a second code.

```jsonc
// 201 Created
{
  "id": "int_01J8X...",
  "status": "open",
  "amount": 120000,
  "ref_code": "K7M2",
  "receiving_account": {
    "provider": "bkash",
    "msisdn": "8801799887766",
    "display_name": "Jomma Store"
  },
  "client_reference": "ORD-2026-001043",
  "expires_at": "2026-09-03T14:38:00Z",
  "created_at": "2026-09-03T14:33:00Z"
}
```

**`409 no_capacity`** when every healthy receiving account already has an open
lock on that exact amount, and the reference pool for the amount is exhausted.
Rare. Client should retry after a short delay or fall back to manual entry.

**`503 no_healthy_account`** when every receiving account is `disabled` or has a
stale heartbeat. The client must not show a pay page in this state.

### `GET /v1/intents/:id`

Poll this from the pay page every 2–3 seconds.

```jsonc
{
  "id": "int_01J8X...",
  "status": "matched",          // open | matched | partial | over | expired | cancelled
  "amount": 120000,
  "received_amount": 120000,
  "ref_code": "K7M2",
  "payments": [
    {
      "trx_id": "BK7X2M9QP1",
      "sender_msisdn": "8801712345678",
      "amount": 120000,
      "occurred_at": "2026-09-03T14:35:12Z",
      "applied_at": "2026-09-03T14:35:14Z",
      "match_confidence": "exact",
      "matched_by": "automatic"
    }
  ],
  "shortfall": 0,
  "excess": 0,
  "expires_at": "2026-09-03T14:38:00Z"
}
```

For `partial`, `shortfall` is what the buyer still owes. For `over`, `excess` is
what they overpaid. The client decides what to do with each; Jomma only reports.

### `POST /v1/intents/:id/cancel`

Releases the lock and expires the reference code immediately. Safe to call on an
already-cancelled intent.

### `POST /v1/intents/:id/extend`

```jsonc
{ "ttl_seconds": 900 }
```

Use when a buyer underpays and you want to hold the order while they top up.
Fails with `409 lock_taken` if another intent has since claimed that amount.

### `POST /v1/submissions`

The manual path. Buyer enters a TrxID because automatic matching didn't fire.

```jsonc
// Request
{
  "intent_id": "int_01J8X...",
  "trx_id": "BK7X2M9QP1",
  "sender_msisdn": "8801712345678",
  "claimed_amount": 120000
}
```

Resolves synchronously against observed payments. Nine outcomes:

```jsonc
// 200 — resolution tells the client exactly what to render
{
  "resolution": "exact",
  "intent_status": "matched"
}
```

| `resolution` | Meaning | `intent_status` |
|---|---|---|
| `exact` | Found, amount and everything matches. Approved. | `matched` |
| `sender_mismatch` | Found, amount exact, paid from a different number. Approved, flagged. | `matched` |
| `underpaid` | Found, less than the intent amount. | `partial` |
| `overpaid` | Found, more than the intent amount. | `over` |
| `not_found_recent` | No such TrxID, intent is under 10 min old. Keep polling. | `open` |
| `not_found_stale` | No such TrxID, intent is older. Escalated to queue. | `open` |
| `already_used` | TrxID already applied to another intent. Rejected. | unchanged |
| `wrong_type` | Found, but it's a cash-in or unrecognised type. Queued. | `open` |
| `expired_intent` | Found, but the intent already expired. Queued for revival. | `expired` |

`underpaid` and `overpaid` responses include the amounts:

```jsonc
{
  "resolution": "underpaid",
  "intent_status": "partial",
  "received_amount": 100000,
  "shortfall": 20000,
  "top_up": {
    "amount": 20000,
    "ref_code": "K7M2",
    "receiving_msisdn": "8801799887766"
  }
}
```

The client renders the message; Jomma supplies the numbers. Do not put
user-facing copy in Jomma — different clients word things differently.

Rate limited to 5 per intent per hour, 20 per API key per minute.

### `GET /v1/accounts`

```jsonc
{
  "accounts": [
    {
      "provider": "bkash",
      "msisdn": "8801799887766",
      "status": "active",              // active | degraded | disabled
      "health": {
        "last_heartbeat_at": "2026-09-03T14:37:41Z",
        "last_capture_at":   "2026-09-03T14:35:12Z",
        "balance_drift": false
      },
      "limits": {
        "daily_used": 4500000,
        "daily_limit": 25000000,
        "utilization": 0.18
      }
    }
  ]
}
```

Clients should check this before rendering a pay page. `degraded` means the
account still works but something is wrong — surface a fallback.

---

## Device API

### `POST /device/v1/capture`

```jsonc
{
  "captures": [                            // batched; send the whole local queue
    {
      "local_id": "c_8891",                // device-side id, for ack
      "source": "notification",            // notification | sms
      "package": "com.bKash.customerapp",
      "raw": "You have received Tk 1,200.00 from 01712345678. Ref K7M2. Fee Tk 0.00. Balance Tk 45,320.00. TrxID BK7X2M9QP1 at 03/09/2026 14:35",
      "captured_at": "2026-09-03T14:35:13Z" // device clock, display only
    }
  ]
}
```

Server behaviour, in order:

1. Verify token and device id.
2. **Store `raw` immediately**, before any parsing.
3. Parse. On failure, store with `parse_status: 'failed'` and raise an alert.
   Never drop.
4. Dedupe on `trx_id`. Duplicates return `duplicate`, not an error.
5. Run balance continuity check.
6. Enqueue matching.

```jsonc
// 200
{
  "results": [
    { "local_id": "c_8891", "status": "accepted", "trx_id": "BK7X2M9QP1" }
  ],
  "server_time": "2026-09-03T14:35:14Z"
}
```

`status` is `accepted`, `duplicate`, or `unparsed`. All three mean the device can
mark it sent and remove it from the local queue — the server has the raw text and
owns it now.

Batching matters: after a network outage the device flushes its whole queue in
one request rather than hammering the endpoint.

### `POST /device/v1/heartbeat`

Every 5 minutes.

```jsonc
{
  "battery": 87,
  "charging": true,
  "network": "wifi",
  "queue_depth": 0,
  "permissions": { "notification_listener": true, "sms": true },
  "app_version": "1.4.0"
}
```

Response can carry commands back:

```jsonc
{
  "ok": true,
  "commands": [ { "type": "flush_queue" } ]
}
```

Command types: `flush_queue`, `resend_since`, `rotate_token`, `stop`.

Commands are delivered **once** — the queue is read and cleared inside one
transaction, under a row lock. A device that crashes between receiving a command
and acting on it will not see it again, so no command may be required for
correctness. Each one is a hint the server can repeat by re-queueing.

Unknown command types must be ignored rather than treated as an error, so new
ones can be added without an app update.

### `POST /device/v1/provision`

The one device endpoint reachable without a device token, because the device does
not have one yet. The dashboard mints a pending device and shows a QR containing
the server URL, a one-time token, and the device id.

```jsonc
// Request
{
  "device_id": "01a068a8-7499-7c13-85cb-7936ca348533",
  "provisioning_token": "jmp_..."
}

// 200
{
  "device_token": "jmd_...",
  "device_id": "01a068a8-7499-7c13-85cb-7936ca348533",
  "account": { "msisdn": "8801799887766", "provider": "bkash" }
}
```

The one-time token is Argon2-hashed at rest, expires after 15 minutes, and is
burned on use by a conditional update — two phones scanning the same code cannot
both end up holding a valid token. Expired, already-claimed, and simply wrong all
return the same `401`; anything more specific tells a holder of a stale QR which
part to change.

### `POST /device/v1/rotate`

```
Authorization: Bearer jmd_<current token>
X-Device-Id:   <uuid>
```

Swaps this device's token, using the one it currently holds. Called after a
heartbeat returns `rotate_token`.

```jsonc
// 200
{ "device_token": "jmd_<new>" }
```

Device-initiated on purpose. The new plaintext can only be handed to whoever is
already holding the current one, so the alternatives were storing a plaintext
token for the device to collect later, or invalidating the old one the moment an
admin clicked a button and hoping the phone noticed — on the single device
watching for incoming money.

So the old token stays valid until the swap succeeds, and dies at that moment.
The update is conditional on the current token prefix, so one command cannot mint
two tokens.

**Rotation is the orderly path. If a token has actually leaked, revoke instead —
that is immediate.**

### `POST /device/v1/events`

```jsonc
{ "kind": "permission_lost", "detail": "notification_listener" }
```

Kinds: `permission_lost`, `service_restarted`, `boot`, `parse_hint`,
`bridge_session_lost`. Each maps to a dashboard alert.

Severity is assigned server-side, not accepted from the device. A compromised
client must not be able to downgrade its own "I lost notification access" to
noise.

---

## Hosted checkout

The way to connect a storefront Jomma knows nothing about. Create an intent with
a `return_url`, redirect the buyer, and wait for the webhook.

```jsonc
// POST /v1/intents
{
  "amount": 75604,
  "client_reference": "ORD-1043",
  "provider": "bkash",            // bkash | nagad | any — the buyer picked this
  "return_url": "https://shop.example.com/orders/1043/thanks",
  "cancel_url": "https://shop.example.com/cart"
}
```

Then send the buyer to:

```
https://your-jomma.example.com/pay/int_01M1NXQWXZFRB8TZM5XF3VZ9XV
```

That page shows the receiving number, the amount and the reference code, plays an
animated walkthrough of the provider's Send Money flow with those values in it,
and updates itself the moment the payment is matched. It asks the buyer which
number they are paying from, which feeds the scorer's sender signal.

**`return_url` and `cancel_url` are checked against the app's registered
hostnames** (Apps → Hosted checkout in the dashboard). An app with none
registered gets no redirect at all rather than any redirect it asks for — an
unchecked return URL on a payment page is an open redirect aimed at somebody who
has just been told to trust the page. Subdomains of a registered host are
included.

### `GET /api/pay/:id/status`

Public, unauthenticated, polled by that page. Returns only what a buyer needs:

```jsonc
{
  "id": "int_01M1NXQWXZFRB8TZM5XF3VZ9XV",
  "status": "matched",            // open | partial | matched | expired | cancelled
  "amount": 75604,
  "received_amount": 75604,
  "shortfall": 0,
  "expires_at": "2026-09-04T10:14:32.030Z",
  "return_url": "https://shop.example.com/orders/1043/thanks"
}
```

No order id, no account id, no other payments. The intent id is a uuidv7 in 26
base32 characters, so it is not guessable, and the endpoint is rate limited by IP.

### `POST /api/pay/:id/payer`

`{ "msisdn": "01712345678" }` — the buyer naming the number they will send from.
Write-once and only while the intent is open, because the caller holds a link
rather than a credential. Setting it at intent creation from your server is
authoritative and skips this entirely.

### Building your own screen instead

Nothing above is required. `POST /v1/intents` returns `ref_code`,
`receiving_account.msisdn`, `amount` and `expires_at`; render them however you
like and poll `GET /v1/intents/:id` with your API key. The hosted page exists so
that a platform with no room for custom checkout code still has a path.

---

## Ingest API

For capture sources that are not devices and have no provisioning story.

### `POST /ingest/v1/webhook`

Authenticated by HMAC alone — the same construction as Jomma's *outbound*
webhooks, over `${timestamp}.${rawBody}` with `WEBHOOK_SIGNING_SECRET`:

```
X-Jomma-Signature: t=1756909512,v1=<hex hmac-sha256>
```

Five-minute tolerance, constant-time comparison, and every rejection is logged
with its IP.

```jsonc
{
  "msisdn": "+8801712345678",     // which receiving number it landed on
  "raw": "You have received Tk 1,200.00 from 01712345678. Ref A7K2. TrxID 9F2K1LM8QR. ...",
  "source": "generic_webhook"     // or "bridge"
}
```

```jsonc
{
  "status": "accepted",           // accepted | duplicate | unparsed
  "trx_id": "9F2K1LM8QR",
  "matched": true,
  "request_id": "req_01J8X..."
}
```

`raw` is stored verbatim before anything tries to read it, parsed with the same
parser as a device capture, deduplicated on the same `trx_id`, and scored by the
same matcher. A source that pre-parses would be a second parser to keep in sync
with the real one, so none is accepted.

The signing secret is the entire authority here, which is why it is a different
secret from anything a client app ever sees.

### Manual entry

No endpoint — it is a server action on the Reconcile page, because it needs an
admin session and the audit trail records who typed it. Same pipeline
otherwise. It is the path that still works when the phone is dead, the notifier
is broken, the provider has changed its format, and the statement has not
arrived.

---

## Webhooks

Delivered by the worker with retries. Client registers a URL and secret per app.

### Signing

```
X-Jomma-Signature: t=1756909512,v1=<hex hmac-sha256>
X-Jomma-Event-Id:  evt_01J8X...
```

Signed payload is `${timestamp}.${rawBody}`. Reject if the timestamp is more than
5 minutes old. Compare in constant time.

### Delivery guarantees

At-least-once. The same `event_id` may arrive twice; receivers must be idempotent.
Retries at 10s, 1m, 5m, 30m, 2h, 6h, 24h. After the final attempt the event is
marked `failed` and surfaced in the dashboard for manual replay.

### Events

```jsonc
{
  "id": "evt_01J8X...",
  "type": "payment.succeeded",
  "created_at": "2026-09-03T14:35:14Z",
  "data": {
    "intent_id": "int_01J8X...",
    "client_reference": "ORD-2026-001043",
    "amount": 120000,
    "received_amount": 120000,
    "trx_id": "BK7X2M9QP1",
    "sender_msisdn": "8801712345678",
    "match_confidence": "exact",
    "matched_by": "automatic",
    "metadata": { "store_id": "st_912" }
  }
}
```

| Type | Fires when |
|---|---|
| `payment.succeeded` | Full amount matched. The main event. |
| `payment.partial` | Some money arrived, short of the total. Includes `shortfall`. |
| `payment.overpaid` | More than the total arrived. Includes `excess`. |
| `payment.expired` | TTL elapsed with no payment. Client should release stock. |
| `payment.cancelled` | Client cancelled, or admin voided. |
| `payment.reversed` | An approved match was undone by an admin. Rare, serious. |
| `account.degraded` | A receiving account went unhealthy. Stop routing to it. |
| `account.recovered` | It came back. |

`payment.reversed` deserves special handling in every client. It means Jomma
previously said money arrived and now says it didn't. The client must be able to
un-fulfil an order.

---

## Errors

```jsonc
{
  "error": {
    "code": "no_healthy_account",
    "message": "No receiving account is currently accepting payments.",
    "request_id": "req_01J8X..."
  }
}
```

| Code | HTTP | Meaning |
|---|---|---|
| `unauthorized` | 401 | Bad or revoked key/token. |
| `forbidden` | 403 | Key valid, resource belongs to another app. |
| `not_found` | 404 | Unknown intent. |
| `validation_failed` | 422 | Zod rejected the body. Includes `details`. |
| `no_capacity` | 409 | No free amount slot. Retry shortly. |
| `lock_taken` | 409 | Extend failed; amount claimed by another intent. |
| `duplicate_submission` | 409 | TrxID already applied elsewhere. |
| `rate_limited` | 429 | Includes `Retry-After`. |
| `no_healthy_account` | 503 | Every account down or disabled. |

`request_id` appears in logs and in the dashboard's request inspector. Always
return it.

---

## Rate limits

| Endpoint | Limit |
|---|---|
| `POST /v1/intents` | 60 / min per key |
| `GET /v1/intents/:id` | 600 / min per key (polling is expected) |
| `POST /v1/submissions` | 20 / min per key, 5 / hour per intent |
| `POST /device/v1/capture` | 120 / min per device |
| `POST /device/v1/heartbeat` | 20 / min per device |
| `POST /ingest/v1/webhook` | 120 / min per IP (no device identity to key on) |

Return `X-RateLimit-Remaining` and `X-RateLimit-Reset` on every response.

---

## SDK

`packages/sdk` ships a typed client so client apps don't hand-roll HTTP.

```ts
import { Jomma } from '@jomma/sdk'

const jomma = new Jomma({ apiKey: process.env.JOMMA_KEY! })

const intent = await jomma.intents.create({
  amount: 120000,
  clientReference: order.id,
  payerMsisdn: order.payerMsisdn,
  ttlSeconds: 300,
})

// Webhook verification
export async function POST(req: Request) {
  const event = await jomma.webhooks.construct(
    await req.text(),
    req.headers.get('x-jomma-signature')!,
    process.env.JOMMA_WEBHOOK_SECRET!,
  )
  // throws on bad signature or stale timestamp
}
```

Keep the SDK thin. It is types, signing, and retries — no business logic.
