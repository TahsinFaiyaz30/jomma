# Deploying Jomma

Target: a managed host, no VPS to administer. Render for the app, a managed
Postgres somewhere else.

Read the first section before you pick a plan. The free tiers have one property
that matters more than the price.

---

## The thing to understand first

**A sleeping web service cannot receive a payment.**

Render's free web services sleep after 15 minutes with no traffic and take
30–60 seconds to wake. Jomma's phones POST captures to `/device/v1/capture` at
the moment money arrives, and the notifier retries — the Android app writes to
Room first and only marks a capture sent on a 2xx, so nothing is lost. But every
capture during a cold start is delayed by up to a minute, which means the buyer
staring at your checkout page is waiting that long too.

That is the whole reason this document recommends a paid web service and is
relaxed about everything else. Render's Starter plan is $7/month and does not
sleep. Everything else here can genuinely be free.

If you want to stay entirely free anyway, it works — see
[Staying free](#staying-free). Just know what you are choosing.

---

## Shape of the deployment

```
Render web service        API + dashboard          $7/mo (or free, sleeps)
Cron                      triggers scheduled jobs  free with an external pinger
Neon / Supabase           Postgres 18              free
```

There is no separate worker process. Every scheduled job — intent expiry, orphan
re-matching, webhook delivery and retries, heartbeat and capture-silence alerts,
idempotency pruning — is implemented in the web app under `apps/web/lib/jobs`,
and reached through one authenticated endpoint:

```
POST /api/internal/sweep?group=all
```

`apps/worker` still exists and is still the right thing on a machine you control:
it is a pg-boss scheduler that calls that same endpoint on four different
cadences. On a managed host a cron entry calls it instead. Both run the same
code, so this is a hosting choice and not a second implementation that drifts.

Groups, if you want the cadences separately: `sweep` (every 30–60s), `webhooks`
(every minute), `health` (every 5 minutes), `maintenance` (hourly). One `all`
call a minute is correct too, just more work than necessary.

---

## 1. Database

Neon is the better fit — it is Postgres 18, it does not expire, and the free
project survives indefinitely.

1. Create a project at [neon.tech](https://neon.tech), region Singapore.
2. Copy the **pooled** connection string. The direct one has a low connection
   ceiling.
3. Make sure it ends with `?sslmode=require`.

Supabase works too. **Render's own free Postgres does not** — it is deleted after
30 days, which is not a database you put payment records in.

Then run the migrations from your machine, once:

```bash
DATABASE_URL='postgres://...?sslmode=require' pnpm db:migrate
```

And create the first admin. Sign-up is disabled in the app, so this is the only
way an account comes into existence:

```bash
DATABASE_URL='postgres://...?sslmode=require' \
JOMMA_ADMIN_EMAIL='you@example.com' \
JOMMA_ADMIN_PASSWORD='...' \
pnpm db:seed --admin-only
```

That creates the admin account and **nothing else**. Sign in, then add your own
receiving accounts, your app and its API key, and a webhook endpoint from the
dashboard.

> **`--admin-only` is not optional here.** The plain `pnpm db:seed` is the
> development seed: it creates a demo app and two receiving accounts on numbers
> nobody owns. Checkout routes real payments across every healthy account, so a
> live instance carrying them can hand a buyer a pay page telling them to send
> money to a stranger's number. The seed now refuses to write demo data to a
> non-local database for that reason, but run the right command anyway.

---

## 2. Web service

`render.yaml` in the repo root is a Render blueprint. From the Render dashboard:
**New → Blueprint**, point it at this repository.

It will ask for `DATABASE_URL`, because that is the one value it cannot
generate. `AUTH_SECRET` and `WEBHOOK_SIGNING_SECRET` are generated for you.

If you would rather click through it by hand:

| Setting | Value |
|---|---|
| Runtime | Node |
| Region | Singapore |
| Build | `corepack enable && pnpm install --frozen-lockfile && pnpm --filter @jomma/web build` |
| Start | `pnpm --filter @jomma/web start` |
| Health check | `/login` |

Environment variables are in [`.env.production.example`](../.env.production.example).

**`APP_URL` must be the service's real public URL, including `https://`.** Set
it in the Render dashboard once the first deploy has named the service:

```
APP_URL=https://jomma-web.onrender.com
```

It is the one variable the blueprint cannot fill in for you. Render's
`fromService: property: host` returns a bare hostname with no scheme, and
everything reading this needs an absolute URL — Better Auth rejects a schemeless
`baseURL`, and the cron builds `${APP_URL}/api/internal/sweep`, which without a
scheme is not fetchable, so no jobs run and no webhook is ever delivered.

Since it is easy to forget and fails quietly, the app now refuses to serve in
production without it: the first request returns a 500 naming `APP_URL` rather
than a working-looking instance that cannot sign anyone in.

Set the same value on the cron service.

---

## 3. Scheduler

`render.yaml` includes a cron service that runs `scripts/run-jobs.mjs` every
minute. Render cron jobs are not on the free tier.

Free alternative: any external pinger. [cron-job.org](https://cron-job.org) is
free and does one-minute intervals. Point it at:

```
POST https://your-app.onrender.com/api/internal/sweep?group=all
Header: x-jomma-internal: <AUTH_SECRET>
```

The endpoint accepts `GET` as well, and accepts the secret as
`Authorization: Bearer <AUTH_SECRET>`, because several cron services only send
GETs and only let you set an Authorization header.

On a free web service this doubles as the keep-alive that stops it sleeping.

**Check that it is actually running.** If the scheduler is dead, intents never
expire, locks are never released, and webhooks are never delivered — and nothing
about the dashboard looks wrong. Reconcile shows "Open intents past their
expiry"; if that number climbs and stays climbing, the scheduler is not running.

---

## 4. Point the phones at it

Set the server URL in the Android app to your Render URL, then provision each
device from the dashboard: **Accounts → a receiving account → Add device**, and
scan the QR with the phone. The one-time token is hashed at rest and expires in
fifteen minutes.

Leave `DEVICE_IP_ALLOWLIST` empty. Phones are on mobile data with rotating
addresses, and an allowlist there locks out your own notifier.

---

## Staying free

It works, with two consequences you are accepting deliberately:

- **The web service sleeps.** Captures during a cold start are delayed up to a
  minute. Nothing is lost — the Android app retries from its local queue — but
  a buyer waiting on checkout waits too. A one-minute external cron ping keeps
  the service awake in practice, which mostly sidesteps this.
- **Neon's free compute suspends** after five minutes idle and takes a few
  hundred milliseconds to resume. Much less disruptive than the web service
  sleeping, and the same cron ping keeps it warm.

Free stack: Render free web service, Neon free Postgres, cron-job.org for the
scheduler. That is a genuinely working deployment for testing and low volume.

For real money moving through it, spend the $7.

---

## Vercel

Also fine for the web service, with one caveat that decides it: Vercel has no
long-running processes, so the scheduler has to be Vercel Cron — and on the Hobby
plan Vercel Cron fires **once a day**, which is useless here. On Pro you get
minute-level crons and it works properly.

If you go this route, `vercel.json`:

```json
{
  "crons": [{ "path": "/api/internal/sweep?group=all", "schedule": "* * * * *" }]
}
```

Vercel Cron sends a GET with its own `Authorization: Bearer $CRON_SECRET`, which
is why the endpoint accepts both a GET and a bearer token. Set `CRON_SECRET` to
the same value as `AUTH_SECRET`.

Render is the simpler answer because the free tier's limitation is a delay, and
Vercel Hobby's is a scheduler that does not run.

---

## Upgrading

Migrations are not run automatically on deploy, on purpose. A migration that
fails halfway through a boot loop on a payments database is a much worse morning
than one you ran yourself.

```bash
git pull
DATABASE_URL='postgres://...' pnpm db:migrate   # from your machine
git push                                        # Render deploys on commit
```

Check `apps/web/drizzle/` for what a release will apply before you run it.

---

## Backups

Neon keeps a restore window on the free tier — enough to undo a mistake, not a
backup you own. Take your own:

```bash
pg_dump "$DATABASE_URL" --format=custom --file="jomma-$(date +%F).dump"
```

`incoming_payments.raw_message` contains live phone numbers and transaction IDs.
Treat a dump the way you would treat the database.
