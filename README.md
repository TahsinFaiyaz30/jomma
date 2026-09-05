# Jomma

**Payment verification for Bangladeshi mobile financial services.**

Your customer sends you a mobile-money transfer. Jomma watches your receiving
account, works out which order that money was for, and tells your store — with a
signed webhook, in seconds, without anybody reading SMS by hand.

**bKash works today, verified against real transfers.** Everything except one
file per provider is provider-agnostic — see [Providers](#providers).

### 📖 [Read the documentation site](https://tahsinfaiyaz30.github.io/jomma/)

The friendly version, with worked examples and copyable code:
[Quick start](https://tahsinfaiyaz30.github.io/jomma/quickstart.html) ·
[API](https://tahsinfaiyaz30.github.io/jomma/api.html) ·
[Webhooks](https://tahsinfaiyaz30.github.io/jomma/webhooks.html) ·
[Matching](https://tahsinfaiyaz30.github.io/jomma/matching.html) ·
[Running it](https://tahsinfaiyaz30.github.io/jomma/self-hosting.html) ·
[Testing](https://tahsinfaiyaz30.github.io/jomma/testing.html)

---

## What it does, and what it does not

Jomma **never moves money and never sees a PIN.** It observes money that has
already arrived and answers one question with high confidence:

> Which order does this payment belong to?

| Jomma does | Jomma does not |
|---|---|
| Issue a unique reference code per order | Move, hold, or refund money |
| Watch your receiving numbers for incoming transfers | Ask for or store anyone's PIN |
| Match a transfer to an order, or refuse to | Guess when it is unsure |
| Tell your store with a signed webhook | Need a merchant account or gateway approval |
| Handle part payments and overpayments | Charge a percentage of anything |

It is not a payment gateway. There is no integration with any provider's servers
— it reads the confirmation messages that arrive on a phone you control.

---

## How it works

```
1. Buyer checks out          Your store → POST /v1/intents → reference code "7CX4Z8ZS"
2. Buyer pays                Buyer opens their wallet, sends ৳1,250 with "7CX4Z8ZS" in Reference
3. Phone sees the message    "You have received Tk 1,250.00 from 018… Ref 7CX4Z8ZS. TrxID …"
4. Jomma matches it          Reference + sender + time window + account → this order
5. Your store is told        POST to your webhook: payment.succeeded
```

Step 3 is the part people ask about. An Android phone with your SIM in it runs
the Jomma notifier app, which forwards the provider's notification and SMS to
your server. Two independent paths — notification and SMS — so one failing does not
lose a payment. There is also a signed webhook endpoint if you have another
source of the same messages.

---

## Providers

**Everything except one file per provider is provider-agnostic.** Intents,
reference codes, the matching rules, the ledger, webhooks, the dashboard and the
hosted checkout deal in "a message arrived on a receiving account". What is
provider-specific is a **parser** — the regexes that turn one provider's
confirmation text into an amount, a sender, a reference and a transaction id.

| Provider | Status | What is missing |
|---|---|---|
| **bKash** | Live, verified against real transfers | Nothing. Three live captures in the fixtures; app and `*247#` both confirmed. |
| **Nagad** | Stubbed, deliberately | The message format. The parser fails loudly rather than guessing, and checkout lists Nagad as unavailable. |
| Banks, cards | Not started | The checkout method picker already lists them as unsupported, so adding one does not change the buyer's flow. |

### Adding one

1. Send a small transfer and save the **exact** confirmation text.
2. Add it to `apps/web/lib/parsers/fixtures/` with the fields you expect.
3. Write the regexes in `apps/web/lib/parsers/<provider>.ts` until it passes.
4. Optionally add a walkthrough in `apps/web/components/pay/guides.tsx`. A
   provider with no guide degrades to plain instructions rather than showing
   somebody else's screens.

Fixtures come first on purpose. A parser written against a guess is a parser
that silently mis-reads money, so every provider starts from a real captured
message or it does not ship.

---

## Quick start — add Jomma to your store

Three steps. This is the whole integration.

### 1. Create a payment when the buyer checks out

```bash
curl -X POST https://your-jomma.example.com/v1/intents \
  -H "Authorization: Bearer jm_live_YOUR_KEY" \
  -H "Idempotency-Key: ORD-2026-001043" \
  -H "Content-Type: application/json" \
  -d '{
    "amount": 125000,
    "client_reference": "ORD-2026-001043",
    "payer_msisdn": "8801712345678",
    "provider": "bkash",
    "return_url": "https://shop.example.com/orders/1043/thanks",
    "cancel_url": "https://shop.example.com/cart"
  }'
```

> **`amount` is in poisha**, not taka. ৳1,250.00 is `125000`. Everything in the
> API is integer minor units so no float ever touches money.

```jsonc
// 201 Created
{
  "id": "int_01M1PEP3ZZEEC99NQ5CM1H6W1Q",
  "status": "open",
  "amount": 125000,
  "ref_code": "7CX4Z8ZS",
  "receiving_account": {
    "provider": "bkash",
    "msisdn": "8801611223344",
    "display_name": "Jomma Store — bKash 2"
  },
  "client_reference": "ORD-2026-001043",
  "expires_at": "2026-09-04T14:05:00Z",
  "created_at": "2026-09-04T13:50:00Z"
}
```

### 2. Send the buyer to the pay page

```
https://your-jomma.example.com/pay/int_01M1PEP3ZZEEC99NQ5CM1H6W1Q
```

That page shows the number, the exact amount and the reference; plays an
animated walkthrough of bKash's Send Money flow with *those values in it*, for
both the app and `*247#`; offers a QR to carry the page to a phone; and turns
into a receipt the moment the money is matched. No polling code for you to write.

Prefer your own checkout screen? [Skip the hosted page](#building-your-own-checkout-screen)
— everything you need is in the response above.

### 3. Handle the webhook

```ts
import { createHmac, timingSafeEqual } from 'node:crypto'

export async function POST(req: Request) {
  const raw = await req.text()
  const header = req.headers.get('x-jomma-signature') ?? ''

  const [t, v1] = [/t=(\d+)/, /v1=([a-f0-9]+)/].map((r) => header.match(r)?.[1])
  if (!t || !v1) return new Response('bad signature', { status: 400 })

  // Reject anything older than five minutes — a valid signature replayed
  // tomorrow is still a replay.
  if (Math.abs(Date.now() / 1000 - Number(t)) > 300) {
    return new Response('stale', { status: 400 })
  }

  const expected = createHmac('sha256', process.env.JOMMA_WEBHOOK_SECRET!)
    .update(`${t}.${raw}`)
    .digest('hex')

  if (!timingSafeEqual(Buffer.from(expected), Buffer.from(v1))) {
    return new Response('bad signature', { status: 400 })
  }

  const event = JSON.parse(raw)

  switch (event.type) {
    case 'payment.succeeded':
      await fulfilOrder(event.data.client_reference)
      break
    case 'payment.partial':
      // event.data.shortfall is what they still owe.
      break
    case 'payment.reversed':
      await unfulfilOrder(event.data.client_reference) // see the warning below
      break
  }

  return new Response('ok') // 2xx stops the retries
}
```

Delivery is **at-least-once** — the same `event.id` can arrive twice, so make
your handler idempotent. Key off `event.id` or `client_reference`.

That is the integration. Everything below is reference.

---

## Integration reference

### Authentication

```
Authorization: Bearer jm_live_xxxxxxxxxxxxxxxxxxxx
```

Keys are Argon2-hashed at rest and shown in plaintext exactly once, at creation
in the dashboard. `jm_test_` keys behave identically against test data.

### Endpoints

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/v1/intents` | Create a payment request. Allocates the reference code. |
| `GET` | `/v1/intents/:id` | Poll status. Rate limit assumes 2–3s polling. |
| `POST` | `/v1/intents/:id/cancel` | Kill it now. Safe to call twice. |
| `POST` | `/v1/intents/:id/extend` | Give the buyer longer. `{ "ttl_seconds": 900 }` |
| `POST` | `/v1/submissions` | Settle by TrxID when the buyer skipped the reference. |
| `GET` | `/v1/accounts` | Which receiving numbers are healthy right now. |

### `POST /v1/intents` — every field

| Field | Type | Required | Notes |
|---|---|---|---|
| `amount` | integer | **yes** | Poisha. ৳1,250.00 → `125000`. |
| `client_reference` | string | **yes** | Your order id. 1–255 chars. Echoed on every webhook. |
| `payer_msisdn` | string | *effectively yes* | The number the buyer will send from. **Without it nothing auto-matches** — see below. |
| `provider` | enum | no | `bkash` \| `nagad` \| `any`. Default `any`. |
| `ttl_seconds` | integer | no | 60–3600. Default 300. |
| `metadata` | object | no | Opaque. Returned on every webhook for this intent. |
| `return_url` | string | no | Where the hosted page sends the buyer on success. |
| `cancel_url` | string | no | Where it sends them if they back out. |

**Always send an `Idempotency-Key` header** — your order id is the right value.
Replaying the same key within 24 hours returns the original intent instead of
allocating a second reference code. Without it, a retried request leaves the
buyer with two live codes for one order and only one of them settles it.

**`payer_msisdn` is not really optional.** Automatic matching refuses any
payment whose intent has no declared sender. If you do not know the buyer's
number, use the hosted pay page — it asks them before showing anything to pay.
An intent without it can only ever be settled by a manual TrxID submission.

**`return_url` and `cancel_url` are checked** against the hostnames registered
for your app under Apps → Hosted checkout. An app with none registered gets no
redirect at all rather than any redirect it asks for; an unchecked return URL on
a payment page is an open redirect aimed at somebody who was just told to trust
that page. Subdomains of a registered host are allowed.

### Intent statuses

| Status | Meaning | Your move |
|---|---|---|
| `open` | Waiting for money. | Show the pay page. |
| `partial` | Some arrived, short of the total. `shortfall` is the rest. | Hold the order; the buyer can top up with the same code. |
| `matched` | Paid in full. | Fulfil. |
| `over` | More arrived than was asked. `excess` is the difference. | Fulfil, and settle the excess — Jomma cannot refund it. |
| `expired` | TTL elapsed with nothing. | Release stock. |
| `cancelled` | You cancelled, or an admin voided it. | — |

### Errors

Every error has the same shape, and always a `request_id` you can quote.

```jsonc
{
  "error": {
    "code": "no_healthy_account",
    "message": "No receiving account is currently accepting payments.",
    "request_id": "req_01J8X..."
  }
}
```

| Code | HTTP | What to do |
|---|---|---|
| `unauthorized` | 401 | Bad or revoked key. |
| `not_found` | 404 | Unknown intent — also returned for another app's intent, deliberately. |
| `validation_failed` | 422 | Your body was wrong. `details` says where. |
| `duplicate_submission` | 409 | That TrxID is already spent on another order. |
| `rate_limited` | 429 | Back off; `Retry-After` says how long. |
| `no_healthy_account` | 503 | Every receiving number is down or disabled. **Do not show a pay page.** |

### Rate limits

`X-RateLimit-Limit`, `X-RateLimit-Remaining` and `X-RateLimit-Reset` come back on
every response, including errors.

| Endpoint | Limit |
|---|---|
| `POST /v1/intents` | 60 / min per key |
| `GET /v1/intents/:id` | 600 / min per key |
| `POST /v1/submissions` | 20 / min per key, and 5 / hour per intent |
| `POST /device/v1/capture` | 120 / min per device |
| `POST /ingest/v1/webhook` | 120 / min per IP |

---

## Webhooks

### Events

| Type | Fires when | Extra fields |
|---|---|---|
| `payment.succeeded` | Full amount matched. **The main one.** | — |
| `payment.partial` | Money arrived, short of the total. | `shortfall` |
| `payment.overpaid` | More than the total arrived. | `excess` |
| `payment.expired` | TTL elapsed with no payment. | — |
| `payment.cancelled` | You cancelled, or an admin voided it. | — |
| `payment.reversed` | An applied match was undone by an admin. | — |
| `payment.refund_requested` | A buyer asked for money back via the pay page. | `reason`, `note` |
| `account.degraded` | A receiving number went unhealthy. | `reason` |
| `account.recovered` | It came back. | — |

```jsonc
{
  "id": "evt_01J8X...",
  "type": "payment.succeeded",
  "created_at": "2026-09-04T13:55:14Z",
  "data": {
    "intent_id": "int_01M1PEP3ZZEEC99NQ5CM1H6W1Q",
    "client_reference": "ORD-2026-001043",
    "amount": 125000,
    "received_amount": 125000,
    "trx_id": "DI4760E7CN",
    "sender_msisdn": "8801712345678",
    "match_confidence": "exact",
    "matched_by": "automatic",
    "metadata": { "store_id": "st_912" }
  }
}
```

> ⚠️ **`payment.reversed` needs real handling.** It means Jomma previously said
> money arrived and now says it did not. If your store cannot un-fulfil an
> order, you will ship goods for a payment that was withdrawn.

> **`payment.refund_requested` is a message, not an instruction.** Jomma watches
> your accounts and has no authority over them — it cannot move money back. The
> event records that a buyer asked; you refund from your own system.

### Signing

```
X-Jomma-Signature: t=1756909512,v1=<hex hmac-sha256>
X-Jomma-Event-Id:  evt_01J8X...
```

The signed payload is `` `${timestamp}.${rawBody}` ``. Sign the **raw body
bytes**, before any JSON parsing — re-serialising changes whitespace and the
signature fails. Compare in constant time, and reject a timestamp more than five
minutes old.

### Retries

At-least-once, retried at **10s, 1m, 5m, 30m, 2h, 6h, 24h**. Return any 2xx to
stop them. After the last attempt the event is marked `failed` and waits in the
dashboard for a manual replay.

---

## The matching rules

This is the part worth understanding, because it decides whether money reaches
the right order. A payment is credited automatically **only if every one of
these holds**:

| # | Requirement | If it fails |
|---|---|---|
| 1 | The message parsed, with an amount above zero | `unparsed` — stored, alerted, never dropped |
| 2 | It arrived on **this intent's** receiving number | `account` |
| 3 | The reference matches the code **exactly** | `reference_missing` / `reference_inexact` |
| 4 | The intent declared a payer number | `sender_undeclared` |
| 5 | The sender **is** that number | `sender_mismatch` |
| 6 | The provider's own timestamp falls inside the checkout window | `before_window` / `after_window` |

Deliberately **not** on that list: the amount. Less than asked is a `partial`,
more is an `over`, and both are recorded against the order. Nobody is refused
for paying the wrong amount — they are refused for being unidentifiable.

**Why the reference is mandatory.** It is the only field that ties money to an
order. Matching on amount and phone number instead would credit the wrong
customer the first time two people paid ৳500 from numbers the system had seen
before. If a buyer skips the field, the payment waits for them to submit the
TrxID by hand — which is the safe failure, not a bug.

**The clock uses the provider's timestamp**, parsed from the message as
Bangladesh time, not when Jomma received it. A phone that was switched off for
an hour still matches correctly on reconnect. Five minutes of grace at each end
absorbs clock skew.

### Reference codes

Eight characters from `ABCDEFGHJKMNPQRSTUVWXYZ23456789` — no `0`, `1`, `I`, `L`
or `O`, because a buyer reads them off a screen and types them into a phone.
That is ~852 billion combinations, and a unique index makes reuse impossible:
**a code is never issued twice, for anyone, ever.** Comparison is
case-insensitive and ignores punctuation on both sides.

---

## Building your own checkout screen

Nothing about the hosted page is required. `POST /v1/intents` gives you
`ref_code`, `receiving_account.msisdn`, `amount` and `expires_at` — render them
however you like and poll `GET /v1/intents/:id`.

Tell the buyer to:

1. Open bKash → **Send Money** (or dial `*247#` → `1`)
2. Send to **`receiving_account.msisdn`**
3. Enter exactly **`amount`**
4. Put **`ref_code`** in the **Reference** field ← the one that matters
5. Confirm with their PIN

If you build your own page, **you must collect the buyer's number** and pass it
as `payer_msisdn`, or nothing will auto-match.

### The SDK

```bash
pnpm add @jomma/sdk
```

```ts
import { Jomma } from '@jomma/sdk'

const jomma = new Jomma({
  apiKey: process.env.JOMMA_KEY!,
  baseUrl: 'https://your-jomma.example.com',
})

const intent = await jomma.intents.create({
  amount: 125000,
  clientReference: order.id,
  payerMsisdn: order.buyerPhone,
  provider: 'bkash',
  returnUrl: `https://shop.example.com/orders/${order.id}/thanks`,
  idempotencyKey: order.id, // do not omit this
})

redirect(jomma.payUrl(intent.id))
```

Verifying a webhook, with the timing-safe comparison and the staleness check
already done:

```ts
import { constructEvent } from '@jomma/sdk'

const event = constructEvent(
  rawBody,
  req.headers.get('x-jomma-signature')!,
  process.env.JOMMA_WEBHOOK_SECRET!,
) // throws SignatureVerificationError on a bad or stale signature
```

The SDK is types, signing and retries. No business logic — anything that decides
what a payment *means* lives on the server, where there is one copy of it.

---

## Running it yourself

Needs **Node 22+**, **pnpm**, and **Docker**.

```bash
pnpm install
cp .env.example .env
pnpm db:up                # Postgres 18 on localhost:5433
pnpm db:migrate
pnpm db:seed              # prints an API key + device token ONCE
```

Fill `AUTH_SECRET` and `WEBHOOK_SIGNING_SECRET` in `.env` first:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Then, in two terminals:

```bash
pnpm dev          # dashboard + API on http://localhost:3000
pnpm dev:worker   # scheduled jobs
```

Sign in with the admin email and password the seed prints. **There is no
signup** — accounts come from the seed or another admin, and
`POST /api/auth/sign-up/email` is disabled.

`PORT=3100 pnpm dev` if 3000 is taken. Set `APP_URL` to match, or sign-in fails
the origin check and looks like a wrong password.

> `pnpm db:seed` is the **development** seed: it creates a demo app and two
> receiving accounts on numbers nobody owns, so the smoke suites have something
> to work with. It refuses to run against a non-local database, because checkout
> routes real payments across every healthy account — a live instance carrying
> those could tell a buyer to send money to a stranger.
>
> To bootstrap a deployment, use **`pnpm db:seed --admin-only`**, which creates
> the admin account and nothing else.

### Postgres 18 is required

Primary keys use `uuidv7()`, which is core in Postgres 18 and does not exist in
17. Migrations fail immediately on an older server. On Neon, pick version 18 at
project creation — the default may be older.

---

## Deploying

Full walkthrough in **[docs/deploy.md](docs/deploy.md)**. The short version:

```
Render web service     API + dashboard + pay page     $7/mo (free tier sleeps)
Neon                   Postgres 18                    free
cron-job.org           calls /api/internal/sweep      free
```

`render.yaml` is a working blueprint. There is no separate worker process to
deploy — every scheduled job lives in the web app under `lib/jobs` and is reached
through one authenticated endpoint, so a cron ping does what the worker does.

**The one thing to know about the free tier:** a Render free web service sleeps
after 15 minutes, and a sleeping service cannot receive a payment capture.
Nothing is lost — the Android app retries from its local queue — but a buyer
watching your checkout waits for the cold start. Note also that webhook delivery
is driven entirely by the cron, so its interval is how long your store waits to
hear about a payment. Buyers are unaffected either way: matching happens inline
and the pay page polls every 2.5 seconds.

---

## The Android notifier

`apps/android/` — a Kotlin app that forwards bKash notifications and SMS to your
server. **[Download the APK](https://github.com/TahsinFaiyaz30/jomma/releases/latest)**
— take the `-release` one; the `-debug` build is for development and is signed
with a different key.

Captures are written to a local Room database **first** and only marked sent on a
2xx, so a flat battery, a dead network or a sleeping server delays a payment
rather than losing it. Two capture paths — notification and SMS — fail
independently; run both.

### Pairing a phone

Accounts → Add device shows a QR. It contains one thing, a URL:

```
https://<your-host>/pair/<one-time-code>
```

**Scan it with anything.** The phone's camera app, whatever scanner is already
installed, or the notifier's own scanner — which will also read the code out of
a screenshot, because the QR is often something that was sent to you rather than
something on a screen in front of you.

Any scanner works because a URL is the one payload every scanner can act on, and
Android App Links then route it into the notifier with no chooser and no
browser. That routing is also the security boundary: since Android 12 an app
that cannot prove the domain endorses it cannot receive the link *or* register
for it, so no other app can intercept a provisioning code.

Nothing readable is in the QR — no token, no device id, no phone number. The
code is still a bearer credential for fifteen minutes and one use, so a
screenshot of a live QR is worth guarding; the narrower claim is that a scanner
which displays what it read shows a host and an opaque string.

### What it keeps

bKash shows the phone far more than payments. **Accounts → What to capture** has
three switches — cash in, money you sent, everything else — and the same three
are in the app, writing to the same row. Incoming Send Money has no switch,
because it is the only type that can settle an order.

Anything switched off is dropped when it reaches the server, so it never fills
the feed. A message the parser cannot read is kept regardless, as long as it
looks like a transaction at all.

Setup and permissions: **[docs/android.md](docs/android.md)**.

---

## Repo layout

```
apps/
  web/                 Next.js 16 — API, dashboard, hosted pay page
    app/api/v1/          Client API          → served at /v1/*
    app/api/device/v1/   Notifier API        → served at /device/v1/*
    app/api/pay/         Public pay-page API (no key; buyers hold a link)
    app/(dash)/          Dashboard screens
    components/pay/      Checkout UI + the animated bKash walkthroughs
    lib/matching/        The rules. Pure functions, no I/O.
    lib/parsers/         Per-provider message parsers + real captures
    lib/services/        Money logic — one implementation per decision
    lib/jobs/            Scheduled work, run by the worker or a cron ping
    lib/db/schema/       Drizzle schema
  worker/              pg-boss scheduler. Calls lib/jobs over the internal endpoint.
  bridge/              Optional Messages scraper, off by default. Best-effort.
  android/             Kotlin notifier app.
packages/
  shared/              Types, env loading, id codec, webhook contract
  sdk/                 Typed client — @jomma/sdk
docs/                  API, matching, design, deploy, android + the docs site
scripts/               Smoke, audit and stress suites
```

**Dashboard screens.** Feed (live, virtualised, keyboard-driven), Queue (approve
and reject with `a`/`r`), Intents (audit timeline and reversal), Accounts
(devices, provisioning QR, rotation, limits), Reconcile (integrity checks and
statement import), Apps (keys, webhook endpoints, delivery log with replay),
Settings.

**One write path.** `lib/services/apply.ts` is the only code that credits an
intent. Automatic matching, buyer TrxID submissions and admin approval all call
it, so the cumulative-sum arithmetic and the row lock exist exactly once.

**Captures store `raw_message` before parsing.** `parseMessage` catches its own
throws, so a provider changing its wording costs an alert and a manual review —
never a lost payment, and re-parsable later.

**Two receiving accounts are seeded by default**, because one phone is a single
point of failure for your whole revenue stream. A degraded account is routed
around rather than blocking checkout.

---

## Testing

```bash
pnpm lint              # Biome
pnpm typecheck         # all five workspaces
pnpm test              # 139 unit tests — no database or .env needed
pnpm test:integration  # needs a live database
pnpm build             # production build
```

Against a running server, with the credentials the seed printed:

```bash
pnpm smoke <api_key> <device_token> <device_id> [<token_2> <id_2>]
pnpm smoke:checkout <api_key>     # the buyer's flow, 51 assertions
pnpm smoke:ingest <api_key>       # signed webhook ingest
pnpm smoke:audit <api_key>        # 46 adversarial checks — run against `next start`
pnpm smoke:stress <api_key>       # concurrency: races, double-spend, idempotency
```

Roughly 300 assertions over the real HTTP surface. A few notes that will save you
an afternoon:

- **Run the suites a minute apart.** They share a per-IP rate limit, so
  back-to-back runs throttle each other — that is the limiter working.
- **Run `pnpm smoke:audit` against `next start`, not `next dev`.** The dev server
  reports a different `Cache-Control` and one check fails spuriously.
- **`pnpm smoke` deliberately degrades an account** to exercise drift detection.
  Re-run `pnpm db:seed` afterwards.

The unit suites need no configuration — no database, no `.env`. That is enforced
rather than hoped for: `vitest.config.ts` supplies a fake environment and stubs
the database client so a test that reaches for a real connection fails loudly.
Integration tests want both and are separate (`pnpm test:integration`).

---

## Versioning and releases

One version for the whole product, in `VERSION` at the repository root. Every
`package.json` and the Android build read from it, because they ship together —
a phone reporting one version to a server running another is a support
conversation nobody can win.

```bash
pnpm version:print         # what is it now
pnpm version:set 1.2.0     # set it everywhere
pnpm version:set minor     # or bump it
```

Never edit the file by hand. Android needs a version code derived from it
(`1.4.2 → 10402`) that can never decrease for an installed app, so the script
refuses a version that would break the arithmetic — at `1.100.0` the minor field
carries and updates start failing on phones nobody is looking at.

Two workflows in `.github/workflows/`:

| Workflow | Runs on | Does |
|---|---|---|
| **CI** | every push to `main`, every PR, or on demand | types, lint, tests, Android unit tests, debug APK |
| **Release** | a `v*` tag, or on demand | both APKs, signed, published as a GitHub Release |

A normal push does **not** cut a release. To cut one:

```bash
pnpm version:set 1.2.0
git commit -am "Release 1.2.0" && git push
git tag v1.2.0 && git push origin v1.2.0
```

The workflow refuses a tag that disagrees with `VERSION`, so `v1.2.0` cannot
publish a build of `1.1.0`, and it runs the full suite before publishing
anything.

> A tag runs the workflow **as it existed at that tag's commit**. If you change
> the workflow and re-tag, move the tag onto the new commit or you will re-run
> the old one.

### Forks

Both workflows offer *Run workflow* in the Actions tab, because a fork inherits
the workflows but not the tags and should still be able to produce an
installable APK from its own build.

Signing comes from four repository secrets — `ANDROID_KEYSTORE_BASE64`,
`ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD` — plus
an optional `JOMMA_HOST` variable so App Links target your own domain. Without
them the release still publishes, debug APK only, and says why: an unsigned
release APK cannot be installed, so shipping one would be shipping nothing.

Full detail, including what a fork must do about App Links:
**[docs/versioning.md](docs/versioning.md)**.

---

## Status

**bKash works end to end** and is verified against real transfers. Three live
captures sit in `lib/parsers/fixtures/bkash.ts`, covering a payment with a
reference, one without, and a `*247#` confirmation. The reference survives both
the app and USSD, and the timestamp is read as Bangladesh time.

Known gaps, stated plainly:

- **Nagad is not implemented.** The message format is unknown, so
  `lib/parsers/nagad.ts` is a deliberate stub that fails loudly rather than
  guessing. Nagad captures store their raw text and wait for a human; checkout
  lists Nagad as unavailable. One real Nagad message closes this.
- **The Android app has only run on an emulator.** Pairing is proven there
  against the production server — App Links verify, the QR decodes from a
  screenshot, and a device provisions end to end — but no emulator has a SIM or
  the bKash app, so **capture itself and reboot survival are unproven on real
  hardware.** That is the gap that matters: forwarding messages is the app's
  entire job.
- **Rate limiting is in-process**, therefore per-instance. Fine on one instance;
  the per-intent submission limit is database-backed either way.
- **The Messages bridge has never held a real pairing.** It is off by default and
  is best-effort — it relays through the phone, so it is *not* redundancy for the
  phone being off.

One operational thing that is not a code issue: bKash distinguishes personal
accounts from merchant and Personal Retail Accounts. Sustained business traffic
on a personal number risks a freeze, which would take the service down rather
than one payment.

---

## Further reading

| Document | What is in it |
|---|---|
| [AGENTS.md](AGENTS.md) | Conventions, invariants, and the open decisions log |
| [docs/api.md](docs/api.md) | Full API reference including the device and ingest surfaces |
| [docs/matching.md](docs/matching.md) | Why the rules are what they are |
| [docs/design.md](docs/design.md) | Design system and the dashboard's information architecture |
| [docs/deploy.md](docs/deploy.md) | Hosting, free-tier trade-offs, backups |
| [docs/android.md](docs/android.md) | Notifier setup, permissions, pairing, App Links |
| [docs/versioning.md](docs/versioning.md) | One version, the release workflows, signing a fork |
