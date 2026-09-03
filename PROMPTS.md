# Prompts

Copy-paste prompts for building Jomma with Claude Code, in order.

**How to use this:** one session per numbered block. Start a fresh session each
time — long sessions accumulate context from work you've moved past and quality
drops. Paste the prompt, read what comes back, correct it, then let it build.

**The habit that matters most:** for anything touching the matcher, the schema, or
money, ask for a plan before code. Fixing a plan costs one message. Fixing 400
lines of wrong code costs an hour.

---

## 0. Before you start

Put these in the repo root before opening Claude Code:

```
jomma/
  AGENTS.md
  docs/
    api.md
    design.md
    android.md
    matching.md      ← the payments failure catalogue, renamed
```

`AGENTS.md` is read automatically every session. You never need to re-explain the
stack.

---

## 1. Scaffold

> Read AGENTS.md and docs/. Set up the monorepo skeleton only — no features.
>
> - `apps/web`: Next.js 16.3.3, App Router, TypeScript strict, Turbopack, React Compiler on
> - `apps/worker`: a Node process with pg-boss
> - `packages/shared`: types shared between web and worker
> - `packages/sdk`: empty package, correct build setup
> - `docker-compose.yml` with Postgres 18
> - Biome, Vitest, and a `.env.example`
>
> Do not add shadcn or any UI yet. Do not create database tables yet.
>
> When it runs, tell me what you set up and what commands I use to start it.

---

## 2. Design system

Do this before any screen. Retrofitting tokens across a finished UI always leaves
stragglers.

> Read docs/design.md. Do build-order steps 1 through 5 only, then stop.
>
> 1. `shadcn init --base base --style mira`, baseColor taupe
> 2. Wire Instrument Sans and IBM Plex Mono via `next/font` as `--font-instrument` and `--font-plex-mono`
> 3. Add the status tokens (matched, pending, ambiguous, offline) under `:root` and `.dark`, exposed through `@theme inline`
> 4. `next-themes` with a three-state toggle (light/dark/system) and the inline flash guard
> 5. A `/dev/tokens` page showing every token and every component state in all three modes
>
> Design the dark tokens first and derive light from them, not the other way round.
>
> Do not build any product screens yet.

Then look at `/dev/tokens` yourself in all three modes. Check the status colours
are legible on their subtle backgrounds. Fix anything off now.

---

## 3. Schema

> Read docs/api.md and docs/matching.md. Before writing anything, show me the
> Drizzle schema you plan to create and the migration. Don't write files yet.
>
> Cover: receiving_accounts, payment_refs, amount_locks, incoming_payments,
> order_payments, payment_submissions, notifier_events, payment_audit, apps,
> api_keys, devices, webhook_endpoints, webhook_deliveries.
>
> Use `uuidv7()` for all primary keys. Every amount is an integer in poisha.
> Include the partial unique indexes on payment_refs.code and
> amount_locks(receiving_account_id, amount_cents).

Read it. Check the partial indexes are right. Then:

> Looks good. Write it, generate the migration, and run it.

---

## 4. The matcher

The most important session. Tests first.

> Read docs/matching.md. Build the matcher in `apps/web/lib/matching/`.
>
> It must be pure functions with no I/O — testable without a database. It takes an
> incoming payment and a list of open intents, and returns a resolution.
>
> Write the tests before the implementation. Cover at minimum:
> - exact reference match, single candidate
> - reference off by one character (Levenshtein 1)
> - reference matching two open codes within distance 1 → must return ambiguous
> - two intents at the same amount in the same window
> - amount mismatch → must never auto-approve, regardless of other signals
> - sender number matches but reference is absent
> - payment arriving with no candidate at all
> - a top candidate beating the second by less than 60 → must return ambiguous
>
> Then implement until they pass. Do not weaken a test to make it pass.

---

## 5. Client API

> Read docs/api.md. Implement the client API in `apps/web/app/api/v1/`.
>
> POST /v1/intents (with Idempotency-Key), GET /v1/intents/:id,
> POST /v1/intents/:id/cancel, POST /v1/intents/:id/extend,
> POST /v1/submissions, GET /v1/accounts.
>
> Zod schema on every input. API key auth with Argon2-hashed keys, prefix stored
> in clear. Return `request_id` on every response including errors.
>
> Reference code allocation retries on unique violation and falls back cleanly
> when the pool is exhausted. Amount locks use the conditional-update guard so two
> simultaneous claims can't both win.
>
> Write integration tests for the intent lifecycle and for the nine submission
> resolutions.

---

## 6. Device API

> Implement the device API in `apps/web/app/api/device/v1/`.
>
> POST /device/v1/capture (batched), /heartbeat, /events.
>
> Critical ordering on capture: store `raw` before any parsing. If parsing fails,
> store with parse_status 'failed' and raise an alert — never drop a message.
> Dedupe on trx_id; duplicates return `duplicate`, not an error.
>
> Implement the balance continuity check: expected = last_known_balance + incoming
> - outgoing since last check. On drift, raise a critical alert.
>
> Device token auth, separate from API keys, per-device revocable.

---

## 7. Webhooks

> Build webhook delivery in `apps/worker`.
>
> HMAC-SHA256 over `${timestamp}.${rawBody}`, sent as
> `X-Jomma-Signature: t=…,v1=…` plus `X-Jomma-Event-Id`.
>
> At-least-once with retries at 10s, 1m, 5m, 30m, 2h, 6h, 24h. After the final
> attempt mark failed and make it replayable from the dashboard.
>
> Events: payment.succeeded, payment.partial, payment.overpaid, payment.expired,
> payment.cancelled, payment.reversed, account.degraded, account.recovered.
>
> Also add the scheduled jobs: intent expiry sweep, orphan re-match retry (every
> 30s for 10 min), heartbeat gap check, stale queue alert.

---

## 8. Dashboard shell

> Read docs/design.md. Build the app shell.
>
> shadcn Sidebar using the sidebar-* tokens. Nav: Feed, Queue, Intents, Accounts,
> Reconcile, Apps, Settings. Counts as badges on nav items.
>
> Receiving account health lives in the sidebar footer, permanently visible — not
> on a settings page. If a device goes down while I'm looking at the queue, I
> should see it without navigating.
>
> Better Auth for admin login. No public signup.
>
> Empty shell pages for each route. No content yet.

---

## 9. The feed

> Build the Feed page — this is the hero of the product.
>
> A live stream of incoming payments, newest first, using @tanstack/react-table
> with @tanstack/react-virtual. Row height 36px, no zebra striping, sticky blurred
> header.
>
> Columns: time, amount (tabular-nums in the sans, not mono), sender, reference
> (mono), status, account. Status is a filled dot plus a label — never colour
> alone.
>
> Live updates. New rows animate in with a fade plus 4px translate, spring
> stiffness 400 damping 30. That's the entire motion budget for this page.
>
> Keyboard: j/k to move, enter to open, / to search, cmd+k for the command
> palette. Show shortcuts with the kbd component in tooltips.
>
> Wrap motion in useReducedMotion. Add a live region so screen readers announce
> arrivals.

---

## 10. Queue

> Build the Queue page — payments needing a human, oldest first.
>
> Each row shows the incoming payment beside the candidate intents the matcher
> found, with the discrepancy highlighted (amount off by X, reference distance,
> sender mismatch).
>
> One-click approve and reject, keyboard-operable with `a` and `r`. Approving must
> never require a pointer.
>
> Approval runs the same transaction path as automatic matching — do not duplicate
> that logic here, call into it.
>
> Show how long each item has been waiting.

---

## 11. Remaining screens

One session each:

> Build the Intents page: open and recent payment requests, filterable by status
> and account, with a detail sheet showing the full timeline from payment_audit.

> Build the Accounts page: receiving accounts with live health, device list,
> provisioning QR, token rotation, daily and monthly limit utilisation with
> warnings at 80% and stop-routing at 95%.

> Build the Reconcile page: CSV statement import, unmatched incoming money, and
> the integrity check for orders marked paid with no payment row. That second
> list must always be empty — surface it loudly if it isn't.

> Build the Apps page: API key creation (plaintext shown once), webhook endpoint
> config, and the delivery log with manual replay.

---

## 12. SDK

> Build packages/sdk. A thin typed client: intents.create, intents.get,
> intents.cancel, submissions.create, and webhooks.construct for signature
> verification with timestamp tolerance.
>
> Types only, signing, and retries. No business logic in the SDK.
> Write a README with the two usage examples from docs/api.md.

---

## 13. Android notifier

Separate session, different language. Do this after the server works end to end.

> Read docs/android.md. Build the Android notifier in apps/android.
>
> Build-order steps 1 through 4 only: Room entity and DAO, the
> NotificationListenerService writing to Room, the batched HTTP flush with
> exponential backoff, and the foreground service plus boot receiver.
>
> The ordering is non-negotiable: write to Room, then POST, then mark sent. Never
> hold a capture only in memory. Do not parse on the device.
>
> Stop after step 4 and tell me how to sideload and test it.

Then:

> Add steps 5 and 6: the heartbeat with command handling, the WorkManager
> watchdog, and the permission self-check. Report permission_lost to the server
> and show a persistent in-app warning.

---

## Prompts to reuse

Keep these handy. They fix most of what goes wrong.

**Before anything risky:**
> Before writing code, tell me your approach and what files you'd touch.

**When it wanders:**
> You've drifted from what I asked. Go back to just the matcher and drop the rest.

**When it over-builds:**
> Smallest change that works. Don't refactor anything I didn't ask about.

**Before merging:**
> Run the tests and the dev server, and confirm the flow actually works end to
> end. Don't tell me it's done until you've checked.

**When it repeats a mistake:**
> That's the third time. Add a rule to AGENTS.md about it and follow it from now
> on.

That last one is the important habit. Chat corrections die with the session. File
corrections are permanent. Your AGENTS.md should be noticeably longer in a month,
and mostly written by Claude Code at your instruction.

**When you add a feature:**
> Update docs/api.md and docs/matching.md to match what you just built.

A stale spec is worse than no spec.

---

## Do this yourself first

Two things block the parser and neither can be guessed:

1. Send ৳10 between two of your own numbers on bKash, via both the app and
   `*247#`. Capture the exact notification text and the exact SMS text. Confirm
   whether the reference you typed appears in the recipient's message, and whether
   the balance is included.
2. Do the same on Nagad, and find its Android package id.

Save every captured string. When you reach the parser session:

> Here are the real captured messages. Write the bKash and Nagad parsers against
> these exact strings and save them as test fixtures in
> apps/web/lib/parsers/fixtures/. Never parse against an assumed format.
