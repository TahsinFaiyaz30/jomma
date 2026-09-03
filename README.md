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

### Verifying it works

```bash
pnpm smoke <api_key> <device_token> <device_id>
```

47 assertions over the real HTTP surface: intent lifecycle, idempotent replay,
lock collision, auth, validation, device capture, automatic matching, all the
submission outcomes, underpayment, and the balance continuity check. Exits
non-zero on failure.

The last section deliberately trips the drift detector, which leaves the seeded
account `degraded`. Re-run `pnpm db:seed` to re-anchor it.

### Everything else

```bash
pnpm test          # 65 unit tests — matcher, parsers, webhook signatures
pnpm typecheck     # all four packages
pnpm lint          # Biome
pnpm build         # production build
pnpm db:reset      # drop, recreate, migrate, seed
pnpm db:studio     # Drizzle Studio
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
packages/
  shared/      Types, env loading, id codec, webhook contract
  sdk/         Typed client for client apps
```

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

---

## Where it is unfinished

- **The dashboard has no authentication.** Better Auth is not wired. The
  `(dash)` layout refuses to render in production unless you explicitly opt out.
- **No Nagad parser.** The message format is unverified; Nagad captures store
  their raw text, fail parsing loudly, and wait for a human.
- **The bKash parser is written against the sample in docs/api.md**, not a real
  capture. Send ৳10 between two of your own numbers, via both the app and
  `*247#`, and replace the fixtures before trusting it.
- Queue, Intents, Accounts, and Apps are shell pages. Feed and Reconcile are real.
- No Android app, no statement import, no Messages bridge.
