# Payments

Self-hosted payment verification for bKash / Nagad send-money, plus manual TrxID
fallback and cash on delivery.

**Design principle:** the system never marks an order paid unless a real incoming
transaction has been observed, matched, and consumed exactly once. Every automatic
path has a manual path behind it. Every failure is loud, never silent.

---

## Provider interface

Everything below is one implementation. Do not couple order code to bKash.

```ts
interface PaymentProvider {
  id: 'manual_bkash' | 'manual_nagad' | 'cod' | 'sslcommerz' | 'bkash_tokenized'
  createIntent(order: Order): Promise<PaymentIntent>
  verify(ref: string): Promise<PaymentStatus>
  refund(ref: string, amountCents: number): Promise<RefundResult>
}

type PaymentStatus =
  | { state: 'pending' }
  | { state: 'paid';      trxId: string; amountCents: number; at: Date }
  | { state: 'partial';   receivedCents: number; shortfallCents: number }
  | { state: 'over';      receivedCents: number; excessCents: number }
  | { state: 'failed';    reason: string }
```

When a real gateway arrives, register a new provider. Nothing else changes.

---

## Schema

```
receiving_accounts              -- your bKash/Nagad numbers
  id
  provider                      -- bkash | nagad
  msisdn
  label
  status                        -- active | degraded | disabled
  daily_limit_cents
  monthly_limit_cents
  last_heartbeat_at
  last_known_balance_cents
  balance_checked_at

payment_refs
  id
  code                          -- 4 chars, e.g. K7M2
  order_id
  status                        -- open | consumed | expired
  created_at, expires_at
  unique index (code) where status = 'open'

amount_locks
  id
  receiving_account_id
  amount_cents
  order_id
  expires_at
  unique index (receiving_account_id, amount_cents) where expires_at > now()

incoming_payments               -- observed money
  id
  receiving_account_id
  provider
  trx_id                unique
  sender_msisdn
  amount_cents
  balance_after_cents           -- for continuity checking
  reference_raw
  reference_normalized
  transaction_type              -- send_money | cash_in | other
  occurred_at                   -- time from the message
  received_at                   -- time your server got it (authoritative)
  raw_message
  source                        -- notification | sms | manual_entry | statement
  parse_status                  -- ok | partial | failed
  status                        -- unmatched | matched | orphaned | refunded

order_payments                  -- join; supports partial/multiple payments
  id
  order_id
  incoming_payment_id   unique
  applied_cents
  applied_at, applied_by        -- null actor = automatic
  unique (order_id, incoming_payment_id)

payment_submissions             -- buyer-entered TrxID (manual path)
  id, order_id
  trx_id, sender_msisdn, claimed_amount_cents
  status                        -- pending | approved | rejected | superseded
  resolution                    -- exact | underpaid | overpaid | not_found | duplicate
  reviewed_by, reviewed_at, note

notifier_events                 -- device health
  id, receiving_account_id, kind  -- heartbeat | capture | error | permission_lost
  payload jsonb, created_at

payment_audit                   -- append-only, everything
  id, actor_id, action, order_id, incoming_payment_id, payload jsonb, created_at
```

Order status for this flow:

```
draft → awaiting_payment → partially_paid → paid → …
                        ↘ expired (stock released)
```

Stock is **reserved** at `awaiting_payment` and **decremented** at `paid`. Never
the reverse, or fake orders drain inventory.

---

## The matcher

> **Superseded.** The pseudocode below is the original design and no longer
> describes the code. It made the **amount** the gate; the implementation makes
> the **reference and the sender** the gates and treats the amount as
> arithmetic. See "What actually ships" below, and `lib/matching/score.ts`.

Amount is a gate, not a signal. Below the gate, nothing auto-approves.

```ts
function score(inc: IncomingPayment, order: Order): number {
  if (inc.amount_cents !== order.total_cents) return -Infinity

  let s = 0
  const ref = normalizeRef(inc.reference_raw)   // uppercase, strip non-alphanumeric

  if (ref && ref === order.ref_code)                       s += 100
  else if (ref && levenshtein(ref, order.ref_code) === 1)  s += 80

  if (sameMsisdn(inc.sender_msisdn, order.expected_msisdn)) s += 60
  if (holdsActiveLock(order, inc))                          s += 50
  if (minutesBetween(order.pay_clicked_at, inc.received_at) <= 10) s += 20

  return s
}
```

Resolution:

- One candidate ≥ 100 → auto-approve.
- Several ≥ 100, top exceeds second by ≥ 60 → auto-approve.
- Otherwise → admin queue as `ambiguous`. **Never guess between two orders.**

Approval runs in one transaction with a conditional update on the lock, so two
simultaneous approvals cannot both win:

```ts
const won = await tx.update(amountLocks)
  .set({ consumed: true })
  .where(and(eq(amountLocks.id, lock.id), eq(amountLocks.consumed, false)))
  .returning()
if (!won.length) throw new Error('lock_race')
```

---

## Manual verification (buyer enters TrxID)

Shown on the pay page below the automatic flow, and linked from the order page.

Buyer submits: TrxID, the number they paid from, the amount they think they sent.

Look up `incoming_payments` by normalized `trx_id`. Nine outcomes, each with its
own message:

### 1. Not found, order is recent (< 10 min)

> We haven't received this payment yet. It usually takes under a minute — this
> page will update on its own.

Keep polling. Do not let them think it failed.

### 2. Not found, order is older (> 10 min)

> We can't find transaction **BK7X2M9QP1**. Please check the TrxID in your bKash
> message. If it's correct, tap Get help and we'll look into it.

Escalate to the admin queue after 3 failed attempts. Rate limit to 5 attempts
per order per hour.

### 3. Found, already applied to a different order

> This transaction was already used for order **#1043**. Each payment can only be
> used once. If you paid twice, contact support and we'll refund the extra.

Never approve. Log to `payment_audit` with both order IDs — this is either an
honest mistake or a fraud attempt and you want the record.

### 4. Found, exact amount, number matches

Auto-approve immediately. Same transaction path as the automatic flow.

### 5. Found, exact amount, different number

Approve. The TrxID alone is strong evidence — it's system-generated and the buyer
could only know it by having made the payment. Flag `sender_mismatch` on the
record so the pattern is visible if it repeats.

### 6. Found, **underpaid**

```
order total     ৳1,200
received        ৳1,000
shortfall       ৳  200
```

> You sent **৳1,000**, but your order total is **৳1,200**.
> Please send the remaining **৳200** to **01XXXXXXXXX** using the same
> reference **K7M2**. Your order is held until then.

- Order → `partially_paid`. Stock stays reserved.
- Write an `order_payments` row for the ৳1,000. The money is recorded, not lost.
- Extend the hold. Default 24 hours, shown as a countdown.
- The pay page now shows the shortfall as the amount due, one-tap copyable.
- When the top-up arrives, sum all `order_payments` for the order. If
  `sum >= total`, mark paid.

**Underpayment is cumulative, not replace.** Two payments of ৳600 must satisfy a
৳1,200 order.

### 7. Found, **overpaid**

```
order total     ৳1,200
received        ৳1,500
excess          ৳  300
```

> You sent **৳1,500**, which is **৳300** more than your order total.
> Your order is confirmed. Choose how to handle the extra:
> **[ Add ৳300 as store credit ]  [ Request a refund ]**

- Approve the order immediately. Never hold goods over an overpayment.
- Excess becomes a `store_credit` ledger entry, or a queued refund task.
- Default to store credit if they don't choose within 48 hours, and tell them
  that in the message.

### 8. Found, but the transaction is not a send-money

Cash-in from an agent, or a transfer type your parser flagged as `other`.

> This looks like an agent deposit rather than a send-money payment. We've sent
> it to our team to confirm manually — usually within a few hours.

Route to admin. Do not auto-approve unusual transaction types.

### 9. Found, matches an **expired** order

> Your order was cancelled because payment didn't arrive in time, but we received
> your **৳1,200**. We've restored your order — checking stock now.

Try to revive: if stock is still available, restore and approve. If not, convert
to store credit or queue a refund, and say which clearly.

---

## Failure catalogue

### Buyer behaviour

| Failure | Fix |
|---|---|
| Skips the reference field | Sender number + amount lock still carry the match. Manual TrxID behind that. |
| Typos the reference | Not auto-matched. Distance is shown in the queue; the buyer proves it with a TrxID. |
| Types spaces or symbols in reference | Normalize hard: uppercase, strip everything non-alphanumeric, then compare. |
| Pays from an undeclared number | Reference + lock carry it. Flag `sender_mismatch` for pattern tracking. |
| Pays the wrong amount | Underpaid/overpaid flows above. |
| Pays twice for one order | Second payment lands unmatched → admin queue → refund or store credit. |
| Pays after the lock expires | Outcome 9: revive order or convert to credit. |
| Pays to the wrong number entirely | Nothing arrives. Manual submission returns `not_found`. Show your correct number prominently in the failure message. |
| Closes the browser mid-payment | Server-side flow is unaffected. Notifier still matches. Send SMS/email confirmation so they learn it worked. |
| Pays in two installments | `order_payments` sums. Partial handling covers it. |
| Uses an agent cash-in instead | Outcome 8. Manual review. |

### Device and notifier

| Failure | Fix |
|---|---|
| **Phone powered off / battery dead** | Heartbeat every 5 min; alert on a 15-min gap. Keep it permanently plugged in, ideally on a small UPS. Disable battery optimization for the app. |
| App killed by the OS | Foreground service with a persistent notification, `WorkManager` periodic watchdog, and a `BOOT_COMPLETED` receiver to auto-restart. |
| Phone reboots | Boot receiver restarts the service; local queue survives in on-device storage. |
| Network drops | **Persist to a local database first, then POST, then mark sent.** Exponential backoff retry. Never hold captures only in memory. |
| Notification permission revoked by an update | Self-check on every launch. If missing, POST a `permission_lost` event and alert. |
| bKash changes the message format | `raw_message` stored before parsing. `parse_status = failed` raises an alert. **Balance continuity** catches the money regardless. |
| Notification captured but app crashes before POST | Write to local DB first. Mark `sent` only after a 2xx response. |
| Duplicate delivery (notification + SMS) | `unique(trx_id)`. Dual capture is deliberate; the constraint deduplicates. |
| Phone clock is wrong | `received_at` (server time) is authoritative for all windows. `occurred_at` from the message is stored but never used for logic. |
| SIM removed or number ported | Heartbeat still passes, so add a second alert: **no captures during business hours for 3 hours**. |
| Phone stolen | Screen lock, remote wipe enabled, no PIN or credentials on device. Notifications contain buyer phone numbers — treat the device as holding customer data. |
| Whole device is a single point of failure | **Two phones, two receiving numbers.** Checkout routes to a healthy account. |

### Silent data loss

The failure that kills this system is money arriving and nobody knowing.

**Balance continuity check.** Every bKash message reports the balance after the
transaction. On each capture:

```
expected = last_known_balance_cents
         + sum(incoming since last check)
         - sum(recorded outgoing since last check)

if (reported_balance != expected)  → alert: missed_transaction, drift = X
```

A gap surfaces on the *next* payment, within minutes, instead of at the weekly
statement import. Record your own outgoing sends (refunds, payouts) so the maths
balances.

**Weekly statement import.** Export from the bKash app, import as CSV with
`source = statement`. `unique(trx_id)` absorbs everything already known. What
remains is money the notifier never saw.

**Two reconciliation screens, checked weekly:**
- Unmatched incoming — money arrived, no order claims it.
- Orders marked paid with no `order_payments` row. **This must always be empty.**
  If it isn't, something wrote a paid status without money, and that's a bug to
  fix immediately.

### Concurrency

| Failure | Fix |
|---|---|
| Two orders, same amount, same window | `amount_locks` partial unique index prevents it. |
| Two admins approve the same payment | Conditional update on lock/status. Loser throws and rolls back. |
| Payment arrives before the order commits | Store as `orphaned`. Retry matching every 30s for 10 min before queueing. |
| A reference code is reused too soon | Do not reissue a code within 24 hours of expiry. |
| Matcher approves the wrong order | Full `payment_audit` trail plus a documented reversal: unapply payment, restore stock, reverse ledger entries with new negative rows. Never delete. |

### Fraud

| Attack | Defence |
|---|---|
| Invented TrxID | Checked against `incoming_payments`. Not found = never approved. |
| Reusing someone else's TrxID | `unique(trx_id)` plus `order_payments` unique constraint. |
| Guessing another buyer's reference code | Codes are random, short-lived, and only ~1M-space for a handful of open orders. Amount must also match exactly. |
| Forged payment screenshot | Screenshots are advisory only. Never sufficient for approval on their own. |
| Spamming manual submissions | Rate limit: 5 per order per hour, 20 per user per day. Track rejection rate per buyer. |
| Fake POSTs to the notifier endpoint | Shared secret in a header, compared in constant time. Rate limited. Every rejected request logged with IP. |

### Business and account

| Failure | Fix |
|---|---|
| Personal account transaction limits hit | Track daily and monthly volume per receiving account against its limit. Warn at 80%, stop routing at 95%, fail over to the second account. |
| Account frozen | Second receiving account on a different number. Checkout routes around a `disabled` account. This is why redundancy is not optional. |
| Cash on delivery refused at the door | Courier API callback marks it refused. Track per-buyer refusal count; block COD after two. |
| Courier remittance doesn't match COD orders | Weekly reconciliation screen for courier settlements, same shape as the bKash one. |

---

## Health monitoring

One admin dashboard, always visible:

- Per receiving account: last heartbeat, last capture, today's volume vs limit,
  balance drift status.
- Orders in `awaiting_payment` older than the lock TTL.
- Unmatched incoming payments count.
- Parse failure count in the last 24 hours.
- Manual queue depth and oldest item age.

Alerts, pushed to your phone:

| Condition | Severity |
|---|---|
| Heartbeat gap > 15 min | Critical |
| Balance drift detected | Critical |
| Paid order with no payment row | Critical |
| No captures for 3 h in business hours | High |
| Parse failure | High |
| Manual queue older than 2 h | Medium |
| Account at 80% of daily limit | Medium |

---

## Build order

1. Schema, provider interface, `PaymentStatus` type
2. Reference codes + partial unique index
3. `expected_msisdn` at checkout
4. Notifier endpoint: secret auth, raw storage, dedupe
5. Matcher + unit tests over synthetic collisions
6. Amount locks + conditional-update approval
7. Pay page with polling and auto-advance
8. Heartbeat, balance continuity, alerting
9. Manual TrxID flow, all nine outcomes
10. Partial and overpayment handling
11. Reconciliation screens + statement import
12. Second receiving account and failover

Steps 1–6 are the engine. 7–12 are what keep it alive in production.

---

## Verify before building the parser

Send ৳10 between two of your own numbers and capture the **exact** notification
and SMS text. Do this for both bKash and Nagad. Confirm:

- Does the reference the sender typed appear in the recipient's message?
- Is the balance included?
- What does a cash-in message look like, versus send-money?
- Does Nagad expose a comparable reference field?

Write the parser against real captured strings, never an assumed format. Keep the
samples as test fixtures.


---

## What actually ships

Three requirements, all of which must hold before anything touches money without
a human. `admits()` in `lib/matching/score.ts` is the single place they live, and
the queue's diagnosis reads the same function so it can never disagree with the
matcher about why something was refused.

1. **The receiving account.** Money on the Nagad number cannot settle a bKash
   intent.
2. **The reference, exactly.** It is the identifier issued per intent and unique
   among open ones. Fuzzy is explicitly not enough — a one-character typo is one
   buyer's money landing on another buyer's order, and the person whose money
   moved has no way to see it.
3. **The sender.** The buyer declares which number they will pay from and the
   message says which number paid. Disagree, or never declared, and the payer is
   not identified.

The **amount is not a requirement**. With the reference and sender established
the payer is known, and how much arrived is arithmetic: short leaves a balance
and the order stays `partial`, over completes it and records an excess. This is
what lets a buyer pay in instalments and have every one verify itself.

### Why the change

The original rule made a part payment unmatchable however perfect the reference,
which is backwards — the code exists precisely so identity does not depend on the
amount. It also meant the amount was doing identification work, and an amount is
not an identity: two buyers ordering the same item at the same price are
indistinguishable under it.

### What this costs

A payment with **no reference** no longer auto-matches at all. Sender plus lock
used to clear the threshold and it no longer does. bKash's reference field is
optional and buyers skip it, so this is a real population — they go to the queue
and are recovered by the buyer submitting a TrxID, which is evidence only the
payer has. That trade was made deliberately: matching on an amount alone cannot
distinguish two buyers who owe the same sum.

The weights still exist. They rank candidates and explain a decision in the
queue; they no longer decide anything on their own. Scores that clear a
threshold are the wrong tool for "must" — 60 + 50 clears 100, and no arrangement
of numbers expresses "the sender has to be the person who said they were paying".

### Manual submission holds the same line

`resolveSubmission` gates on the same account and the same sender. A TrxID for
money that landed on a different account resolves as not-found for this intent,
and a payment from a number the intent never declared is escalated to a human
rather than credited — the money is real, so refusing it would strand it, but
nobody is credited until a person has looked.
