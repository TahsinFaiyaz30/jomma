# @jomma/sdk

Typed client for the [Jomma](../../README.md) payment verification API.

Thin by design: types, signing, and retries. No business logic — anything that
decides what a payment *means* stays on the server, where there is exactly one
copy of it.

```bash
pnpm add @jomma/sdk
```

Requires Node 20+ (uses `fetch` and `node:crypto`).

---

## Creating a payment request

```ts
import { Jomma } from '@jomma/sdk'

const jomma = new Jomma({
  apiKey: process.env.JOMMA_KEY!,
  baseUrl: process.env.JOMMA_URL,
})

const intent = await jomma.intents.create({
  amount: 120000,                 // poisha — ৳1,200.00
  clientReference: order.id,
  payerMsisdn: order.payerMsisdn, // optional, boosts match confidence
  ttlSeconds: 300,
  idempotencyKey: order.id,       // see below
})

// Show the buyer these three things, and nothing else.
intent.receiving_account.msisdn   // 8801799887766
intent.amount                     // 120000
intent.ref_code                   // K7M2
```

**Always pass `idempotencyKey`.** Your order id is the right value. Without one
the SDK generates a fresh key per call, so a retried request allocates a second
reference code and a second amount lock — exactly the collision the lock exists
to prevent. Replaying the same key within 24 hours returns the original intent.

### Polling the pay page

```ts
const current = await jomma.intents.get(intent.id)

switch (current.status) {
  case 'matched':  return fulfil(order)
  case 'partial':  return showShortfall(current.shortfall)
  case 'over':     return confirmAndOfferCredit(current.excess)
  case 'expired':  return releaseStock(order)
  case 'open':     return // keep polling, every 2–3s
}
```

`GET /v1/intents/:id` is rate limited at 600/min per key — polling is expected.

---

## Verifying a webhook

```ts
export async function POST(req: Request) {
  const event = await jomma.webhooks.construct(
    await req.text(),                          // raw body, not a parsed object
    req.headers.get('x-jomma-signature')!,
    process.env.JOMMA_WEBHOOK_SECRET!,
  )
  // throws on bad signature or stale timestamp

  switch (event.type) {
    case 'payment.succeeded': /* … */ break
    case 'payment.reversed':  /* … */ break
  }

  return new Response(null, { status: 200 })
}
```

Three things this gets right, and that are easy to get wrong by hand:

- **Raw body.** `JSON.parse` then `JSON.stringify` can reorder keys and change
  whitespace. The HMAC covers the exact bytes that were sent.
- **Timestamp tolerance.** Five minutes, so a captured request cannot be replayed
  a day later.
- **Constant-time comparison.** A naive `===` leaks the signature one byte at a
  time.

Delivery is **at-least-once**. The same `event_id` may arrive twice; make your
handler idempotent. Retries run at 10s, 1m, 5m, 30m, 2h, 6h, 24h.

`payment.reversed` deserves special handling: it means Jomma previously said
money arrived and is now retracting that. Your app must be able to un-fulfil an
order.

---

## The manual path

When automatic matching doesn't fire, the buyer types their TrxID:

```ts
const result = await jomma.submissions.create({
  intentId: intent.id,
  trxId: 'BK7X2M9QP1',
  senderMsisdn: '8801712345678',
  claimedAmount: 120000,
})
```

Nine resolutions. Jomma supplies the numbers; **you** write the words, because
different clients word these differently.

| `resolution` | What happened | What to render |
|---|---|---|
| `exact` | Found, everything matches | Confirmed |
| `sender_mismatch` | Found, paid from another number | Confirmed (flagged server-side) |
| `underpaid` | Short — `shortfall` and `top_up` included | Ask for the remainder |
| `overpaid` | Over — `excess` included | Confirm, offer credit or refund |
| `not_found_recent` | Nothing observed, intent under 10 min old | "Still waiting" — keep polling |
| `not_found_stale` | Nothing observed, older | "Check the TrxID", offer help |
| `already_used` | That TrxID paid a different order | Refuse, offer support |
| `wrong_type` | An agent cash-in, not a send-money | "Being reviewed manually" |
| `expired_intent` | The intent already expired | "Restoring your order" |

Rate limited to 5 per intent per hour. The SDK does **not** retry submissions —
burning an attempt on a network blip is the wrong trade.

---

## Checking account health

```ts
const accounts = await jomma.accounts.list()
const usable = accounts.filter((a) => a.status === 'active')

if (usable.length === 0) {
  // Do not render a pay page. Nothing is accepting payments.
}
```

`degraded` means the account still works but something is wrong — surface a
fallback rather than a dead end.

---

## Errors

Every failure is a `JommaError` carrying the `request_id` from the response.
Keep it: it is what turns "a payment failed yesterday" into one log line.

```ts
import { JommaError } from '@jomma/sdk'

try {
  await jomma.intents.create({ /* … */ })
} catch (error) {
  if (error instanceof JommaError) {
    console.error(error.code, error.requestId)
    if (error.code === 'no_healthy_account') return showFallbackInstructions()
    if (error.retryable) return retryLater()
  }
  throw error
}
```

| `code` | HTTP | Meaning |
|---|---|---|
| `unauthorized` | 401 | Bad or revoked key |
| `forbidden` | 403 | That intent belongs to another app |
| `not_found` | 404 | Unknown intent |
| `validation_failed` | 422 | Includes `details` |
| `no_capacity` | 409 | No free amount slot — retry shortly |
| `lock_taken` | 409 | Extend failed; the amount was claimed |
| `duplicate_submission` | 409 | TrxID already applied elsewhere |
| `rate_limited` | 429 | Honours `Retry-After` |
| `no_healthy_account` | 503 | Every account down or disabled |

The client retries `GET`s and idempotent `POST`s on 429, 5xx, and network
failures — twice by default, with jittered backoff, honouring `Retry-After`.

---

## Options

```ts
new Jomma({
  apiKey: process.env.JOMMA_KEY!,
  baseUrl: 'https://jomma.example.com',  // default http://localhost:3000
  timeoutMs: 15_000,
  maxRetries: 2,
  fetch: customFetch,                    // for testing
})
```
