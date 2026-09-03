# jomma

Payment verification for Bangladeshi mobile financial services. Watches a
bKash/Nagad account, matches incoming transfers to payment requests, and delivers
signed webhooks.

Jomma never moves money and never touches a PIN. It observes money that has
already arrived and answers one question with high confidence: *which order does
this payment belong to?*

Read [AGENTS.md](AGENTS.md) first, then [docs/api.md](docs/api.md),
[docs/matching.md](docs/matching.md), and [docs/design.md](docs/design.md).

---

## Running it

Needs Node 22+, pnpm, and Docker.

```bash
pnpm install
cp .env.example .env      # then fill in AUTH_SECRET and WEBHOOK_SIGNING_SECRET
pnpm db:up                # Postgres 18 on localhost:5433
pnpm db:migrate
pnpm db:seed              # prints an API key, a device token, and a device id — once
```

Generate the two secrets with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Then, in two terminals:

```bash
pnpm dev
```

```bash
pnpm dev:worker
```

- Dashboard and API — http://localhost:3000
- Design tokens — http://localhost:3000/dev/tokens

`PORT=3100 pnpm dev` if 3000 is taken.

Sign in with the admin email and password the seed prints. There is no signup —
accounts are created by the seed or by another admin, and `POST
/api/auth/sign-up/email` is disabled.

### Verifying it works

```bash
pnpm smoke <api_key> <device_token> <device_id> [<device_token_2> <device_id_2>]
```

52 assertions over the real HTTP surface: intent lifecycle, idempotent replay,
auth, validation, device capture, automatic matching, all the submission
outcomes, underpayment, two-account failover, and the balance continuity check.
Pass the second device to exercise failover. Exits non-zero on failure.

The last section deliberately trips the drift detector, which leaves one seeded
account `degraded`. Re-run `pnpm db:seed` to re-anchor it.

### Everything else

```bash
pnpm test              # 81 unit tests — matcher, parsers, CSV, signatures
pnpm test:integration  # needs a live database; statement import, device commands
pnpm typecheck         # all four packages
pnpm lint              # Biome
pnpm build             # production build
pnpm db:reset          # drop, recreate, migrate, seed
pnpm db:studio         # Drizzle Studio
```

---

## Layout

```
apps/
  web/         Next.js 16 — client API, device API, dashboard
    app/(dash)/          Dashboard screens
    app/api/v1/          Client API      (served at /v1/*)
    app/api/device/v1/   Notifier API    (served at /device/v1/*)
    lib/matching/        The scorer. Pure functions, no I/O.
    lib/parsers/         Per-provider message parsers + fixtures
    lib/services/        Money logic — one implementation of each decision
    lib/db/schema/       Drizzle schema
  worker/      pg-boss — webhook delivery, expiry sweeps, health alerts
  android/     Kotlin notifier. Written, never compiled — see its README.
packages/
  shared/      Types, env loading, id codec, webhook contract
  sdk/         Typed client for client apps
```

Screens: **Feed** (live, virtualized, keyboard-driven), **Queue** (approve and
reject with `a`/`r`), **Intents** (with the audit timeline and reversal),
**Accounts** (devices, provisioning QR, rotation, limits), **Reconcile**
(integrity checks and statement import), **Apps** (keys, endpoints, delivery log
with replay), **Settings**.

The route files live under `app/api/` per AGENTS.md, and `next.config.ts`
rewrites `/v1/*` and `/device/v1/*` onto them so the public URLs match
docs/api.md.

---

## The parts that matter

**The matcher** (`apps/web/lib/matching/`) is pure functions with no I/O, tested
against synthetic collision cases without a database. Amount is a gate, not a
signal; two close candidates escalate to a human rather than being ranked.

**`applyPayment`** (`apps/web/lib/services/apply.ts`) is the only code path that
credits an intent. Automatic matching, buyer TrxID submissions, and admin
approval all call it, so there is exactly one implementation of the conditional
lock update and the cumulative-sum logic.

**Captures store `raw_message` before parsing.** `parseMessage` is total — it
catches its own throws — so a provider changing its format costs an alert and a
manual review, never a lost payment.

**Two receiving accounts are seeded by default**, because one phone is a single
point of failure for the whole revenue stream. Two intents at the same amount
route to different accounts; a drifting or disabled account is routed around
rather than blocking checkout. The smoke suite exercises this.

---

## Where it is unfinished

Two of these are blocked on you, not on code.

- **The bKash parser is written against the illustrative sample in docs/api.md**,
  not a real capture. Send ৳10 between two of your own numbers, via both the app
  and `*247#`, capture the exact notification and SMS text, and replace the
  fixtures. Until then the matcher's strongest signal is unverified.
  (AGENTS.md open decision #3.)
- **No Nagad parser.** The message format is unknown. Nagad captures store their
  raw text, fail parsing loudly, and wait for a human — never dropped, and
  recoverable by re-parsing once the format is known.
  (AGENTS.md open decision #2.)
- **The Android app has never been compiled.** Written from docs/android.md on a
  machine with no Android SDK. See [apps/android/README.md](apps/android/README.md).
- **No deploy config.** The compose file runs Postgres for development only;
  the deployment target is still open (AGENTS.md #1).
- Rate limiting is in-process, so it is per-instance. Fine for one VPS; the
  per-intent submission limit is database-backed and survives restarts either way.
- No Messages bridge. The feature flag exists and is off.
