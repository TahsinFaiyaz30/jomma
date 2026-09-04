# AGENTS.md — Jomma

Context for AI agents working in this repo. Read this before writing code.

---

## What Jomma is

**Jomma** (জমা — "deposited") is a standalone payment verification service for
Bangladeshi mobile financial services. It watches a personal bKash/Nagad account,
detects incoming send-money transactions, matches each one to a payment request,
and notifies the client application over a signed webhook.

It is **not** a payment gateway. It never moves money and never touches a PIN. It
only observes money that has already arrived and answers one question with high
confidence: *which order does this payment belong to?*

It is multi-tenant by API key, so one Jomma instance serves several client apps.

### Boundaries

Jomma owns: receiving accounts, reference codes, amount locks, incoming payment
records, matching, device health, reconciliation, webhook delivery.

Jomma does not own: orders, carts, products, users, stock, or a business ledger.
Those live in the client app. Jomma stores an opaque `client_reference` and hands
it back on the webhook.

---

## Architecture

```
┌──────────────┐   POST /v1/intents      ┌─────────────────────┐
│  Client app  │ ──────────────────────▶ │                     │
│ (ecommerce)  │ ◀────────────────────── │      Jomma API      │
└──────────────┘   signed webhooks       │   (Next.js routes)  │
                                          │                     │
┌──────────────┐   POST /device/v1/*     │                     │
│ Android app  │ ──────────────────────▶ │                     │
│  (notifier)  │                          └──────────┬──────────┘
└──────────────┘                                     │
                                          ┌──────────▼──────────┐
┌──────────────┐                          │   Postgres 18       │
│  Dashboard   │ ◀──── same Next.js app   │   + pg-boss queue   │
└──────────────┘                          └──────────┬──────────┘
                                          ┌──────────▼──────────┐
                                          │   Worker process    │
                                          │ expiry · webhooks · │
                                          │ alerts · reconcile  │
                                          └─────────────────────┘
```

Three deployables from one repo: **web** (API + dashboard), **worker**, and the
**Android app**.

---

## Stack

Pinned as of September 2026. No major upgrades without being asked.

### Server

```
next            16.3.3    Active LTS. App Router. Turbopack.
react           19.2.7    React Compiler enabled.
typescript      5.x       strict. No `any` without a comment.
node            22 LTS
pnpm                      Package manager.

postgresql      18.x      uuidv7() for all primary keys.
drizzle-orm     0.45.x    Schema in TypeScript.
pg-boss                   Job queue. Postgres-backed — no Redis needed.
zod                       Validation at every boundary.
better-auth               Dashboard login only. Small admin user count.
pino                      Structured logs. Never log full msisdns or raw messages
                          at info level.
```

**Why pg-boss and not BullMQ:** one fewer service to run and monitor. Jobs are
low-volume (webhook retries, expiry sweeps, alerts). Postgres already has to be
up for anything to work, so it adds no new failure mode. Revisit only if job
volume genuinely outgrows it.

### Dashboard UI

```
tailwindcss             4.3.x    CSS-first @theme. No tailwind.config.js.
shadcn/ui                        Base UI base: npx shadcn init --base base
@base-ui/react          1.6.x
motion                  13.1.x   import from "motion/react". Used sparingly.
@tanstack/react-table            The payment feed and queues are tables.
@tanstack/react-virtual          Feed can run to thousands of rows.
recharts                         Volume and match-rate charts only.
```

### Android notifier

```
kotlin                           Jetpack Compose for the (minimal) UI.
Room                             Local capture queue. Survives reboot.
WorkManager                      Watchdog + retry scheduling.
OkHttp                           HTTP with retry/backoff.
minSdk 26
```

See `docs/android.md`.

---

## Repo layout

```
apps/
  web/                    Next.js — API routes + dashboard
    app/
      (dash)/             Dashboard UI
      api/v1/             Client API
      api/device/v1/      Notifier API
    components/
    lib/
      matching/           The scorer. Pure functions. Heavily tested.
      parsers/            Per-provider message parsers + fixtures
      webhooks/           Signing, delivery, retry
      db/schema/
  worker/                 pg-boss job definitions
  android/                Kotlin notifier app
packages/
  shared/                 Types shared between web and worker
  sdk/                    TypeScript client SDK for client apps
docs/
  api.md                  Full API surface
  android.md              Notifier app spec
  matching.md             Scorer logic and failure catalogue
```

---

## Hard rules

**Jomma never marks a payment matched without an observed transaction.** There is
no code path that produces a `payment.succeeded` webhook from anything other than
a real row in `incoming_payments`.

**Amount is a gate, not a signal.** If the received amount does not exactly equal
the intent amount, the automatic path never fires. Partial and over payments have
their own explicit outcomes.

**Never guess between two candidates.** If two intents both score above threshold
and are close, the payment goes to the manual queue. Ambiguity is escalated, never
resolved by ranking.

**`received_at` (server time) is authoritative.** Never use the timestamp parsed
from a message for window logic. Phone clocks drift. Store `occurred_at`
separately for display only.

**Store `raw_message` before parsing, always.** Parsers break when providers change
formats. The raw text is how you recover payments a broken parser rejected.

**Every ingestion path deduplicates on `trx_id`.** One unique constraint protects
against duplicate delivery, dual capture, retries, and statement re-imports
simultaneously.

**API keys are hashed at rest.** Argon2, same as passwords. The plaintext key is
shown once at creation and never again.

**Webhooks are signed and idempotent.** HMAC-SHA256 over timestamp plus body.
Receivers must be able to process the same event twice safely, so every event
carries a stable `event_id`.

**No PINs, no credentials, no money movement.** If a feature request requires
holding a user's MFS PIN or initiating a transfer, it does not belong in Jomma.

---

## Ingestion adapters

Sources are pluggable. Each implements the same interface and writes to the same
table, deduplicated by `trx_id`.

```ts
interface IngestAdapter {
  id: 'android_notification' | 'android_sms' | 'messages_bridge'
    | 'manual_entry' | 'statement_import' | 'generic_webhook'
  reliability: 'primary' | 'secondary' | 'best_effort'
}
```

| Adapter | Reliability | Notes |
|---|---|---|
| `android_notification` | primary | NotificationListenerService. Fastest, most reliable. |
| `android_sms` | primary | Same app, second path. Fails independently of notifications. Run both. |
| `manual_entry` | secondary | Admin pastes a message into the dashboard. Always available. |
| `statement_import` | secondary | Weekly CSV export. Catches anything missed. |
| `generic_webhook` | secondary | Signed endpoint any future source can POST to. |
| `messages_bridge` | best_effort | See below. |

### The Messages bridge (optional)

A small Playwright process holding a paired `messages.google.com` session,
polling for new bKash/Nagad messages and POSTing them to the generic webhook
endpoint.

Build it as an **opt-in adapter behind a feature flag**, clearly labelled
best-effort in the dashboard. Known limitations, which must be documented in the
UI where it's enabled:

- It relays through the phone, so it does **not** protect against the phone being
  off or offline. It is not redundancy for the primary failure mode.
- The pairing expires after inactivity and needs re-scanning.
- It scrapes a DOM that changes without notice.
- Sessions get signed out; the bridge must detect this and raise an alert rather
  than silently returning nothing.

Because of the last point, the bridge reports its own health on the same
heartbeat mechanism as the Android app. A bridge that has stopped finding
messages must be indistinguishable from a bridge that is down, and both must
alert.

---

## Core flow

```
1. Client POSTs /v1/intents  { amount, client_reference, payer_msisdn?, ttl }
   → Jomma allocates a reference code (4 chars, unique among open)
   → takes an exclusive lock on (receiving_account, amount)
   → returns { intent_id, ref_code, receiving_msisdn, amount, expires_at }

2. Client shows the buyer: number, exact amount, reference code.

3. Buyer sends money via their bKash app, typing the code as reference.

4. Notifier captures the message → POST /device/v1/capture
   → raw stored, parsed, deduped on trx_id

5. Matcher scores the capture against open intents.
   → one confident match → consume lock, mark matched
   → ambiguous or none  → manual queue

6. Worker delivers a signed webhook to the client:
   payment.succeeded | payment.partial | payment.overpaid | payment.expired
```

Matching logic and the full failure catalogue live in `docs/matching.md`.

---

## Dashboard design

Full spec in **`docs/design.md`**. Read it before writing any component.

Locked decisions:

```
style        base-mira      Base UI + Mira. Maximum density — built for tables and admin.
baseColor    taupe          Warm neutral. Not Neutral/Zinc — those read as default.
themes       light | dark | system, via next-themes. Dark designed first.
UI font      Instrument Sans
Figure font  IBM Plex Mono  TrxIDs and codes only. Amounts use tabular-nums sans.
prose        shadcn/typeset for docs and markdown. Not for dashboard chrome.
```

The hero is a live payment feed, not KPI tiles. Account health lives permanently
in the sidebar footer. Status is a dot plus a label, never colour alone. Red is
reserved for things that are actually broken — "unmatched" is normal and must not
be red.

---

## Security

- API keys: Argon2-hashed, prefix-identifiable (`jm_live_…`), shown once.
- Device tokens: separate from API keys, rotatable, revocable per device.
- Webhook signatures: HMAC-SHA256 over `timestamp.body`, 5-minute tolerance
  window, constant-time comparison.
- Rate limits per app and per device. Log every rejected request with its IP.
- Optional IP allowlist on the device endpoint.
- `raw_message` contains buyer phone numbers. Treat the table as PII: no raw
  messages in logs, redact msisdns in anything shipped to an error tracker.
- The dashboard is admin-only. No public signup.

---

## Working style

- Read `docs/api.md` and `docs/matching.md` before touching matching or the API.
- The matcher is pure functions with no I/O. It must be unit-testable without a
  database. Test it against synthetic collision cases before wiring anything up.
- Parsers ship with real captured message fixtures. Never write a parser against
  an assumed format.
- Small commits, one concern each.
- When a decision is ambiguous and expensive to reverse, stop and ask.

---

## Open decisions

1. **Deployment target.** ✅ Decided: a managed host, no VPS. Render for the web
   service, Neon for Postgres, a cron service in place of a persistent worker.
   `render.yaml` and `docs/deploy.md` cover it. `docker-compose.yml` still runs
   Postgres alone for local development.

   The consequence worth knowing: every scheduled job now lives in
   `apps/web/lib/jobs` behind `POST /api/internal/sweep?group=…`, so a cron ping
   and `apps/worker` run *the same code*. The worker is a scheduler, not a second
   implementation, which is what makes hosting without a background process a
   configuration choice rather than a fork.
2. **Nagad message format.** ⛔ Still unknown. `lib/parsers/nagad.ts` is a
   deliberate stub that returns `parse_status: 'failed'`, which stores the raw
   text and raises a `parse_failure` alert rather than guessing at a format.
   Capture a real Nagad send-money and cash-in, save them under
   `lib/parsers/fixtures/`, and write the regexes against those strings.
3. **Whether bKash send-money reference appears in the recipient's message on all
   channels** (app vs `*247#`). ⛔ Still unverified. The bKash parser is written
   against the single illustrative sample in `docs/api.md` and its other fixtures
   are synthetic. Must be verified with a real ৳10 transfer before the matcher is
   trusted in production.
4. **Bengali localisation.** ✅ Decided: bilingual bn + en from the start. Hind
   Siliguri via `next/font`, `Intl` with `bn-BD` (Bengali numerals, lakh
   grouping) and `en-BD`. Copy lives in `lib/i18n/messages.ts`; the locale is a
   cookie read by the root layout so the first paint is already correct.

---

## Deviations from the specs above

Recorded here because the code deliberately differs from what the docs say, and
each difference is load-bearing.

**`amount_locks` uses a status column, not `expires_at`, in its partial index.**
`docs/matching.md` specifies `unique (receiving_account_id, amount_cents) where
expires_at > now()`. Postgres rejects that — index predicates must be IMMUTABLE
and `now()` is STABLE. The equivalent guarantee is
`where status = 'active'` plus a worker sweep that flips `active` → `expired`,
and an inline reclaim on the create path so correctness never depends on the
sweeper having run. Read paths still test `expires_at`.

**Status tokens have four roles, not three.** `docs/design.md` pairs
`bg-*-subtle` with `text-*-foreground`, which is unreadable in both themes — the
two are either both light or both dark. `-foreground` means "text on the solid
fill" and `-subtle-foreground` means "text on the tinted surface". Use the pair
that matches the surface.

**Two tables exist that the schema list does not mention.** `payment_intents` is
the core entity the client API operates on; `docs/matching.md` calls it `orders`
because it was written from inside an ecommerce app, but standalone Jomma does
not own orders. `idempotency_keys` is required by `Idempotency-Key` on
`POST /v1/intents` and needs its own expiry, which a column on `payment_intents`
could not provide. `order_payments` keeps its name and points at an intent.

**The Messages bridge lives in `apps/bridge`, and it heartbeats conditionally.**
The spec asks for a bridge that "reports its own health on the same heartbeat
mechanism as the Android app". It does that literally: it provisions as a device
(`platform: 'bridge'`) and POSTs to `/device/v1/heartbeat`, so one worker job
detects a dead phone and a dead bridge. The load-bearing part is the negative —
it sends **no** heartbeat while its session is unhealthy, so an expired pairing
or a changed DOM produces the same gap alert as a process that is not running.
It also raises `bridge_session_lost` on the way into a fault, because that is
the only signal that can say *why*, but the gap is the backstop. Captures go to
`/ingest/v1/webhook`, not the device capture endpoint: the bridge is not a
capture device and does not get a capture device's authority.

**Balance drift is graded by direction.** There is no outgoing-transaction table,
so a legitimate refund or payout would register as drift and fire a critical
alert every time — which is exactly how alarm fatigue starts. A balance *lower*
than expected is medium severity and keeps routing; a balance *higher* than
expected means money arrived that was never seen, which is critical and stops
routing. Add an `outgoing_payments` table and the check can become symmetric.
