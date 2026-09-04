# Messages bridge

A Playwright process that holds a paired `messages.google.com` session, polls for
new bKash/Nagad messages, and POSTs them to Jomma's signed ingest endpoint.

**It is optional, opt-in, and best-effort.** Read the limitations before you run
it.

## What it does not do

- **It does not protect against the phone being off or offline.** It relays
  *through* the phone. If the phone is dead, the bridge sees nothing — and that
  is the failure this system actually has to survive. Two phones on two accounts
  is the redundancy story. This is not a third one.
- **The pairing expires** after inactivity and has to be re-scanned by a person.
- **It scrapes a DOM that changes without notice.** Every selector in
  `src/scrape.ts` is a guess about somebody else's markup.

It is worth running only for the narrower case: the Android app has been killed
or has lost a permission, while the phone itself is fine and online.

## How it reports being broken

The bridge sends a heartbeat **only while its session is healthy**. An expired
pairing, an unrecognised page, a crashed browser — each one stops the heartbeat,
and the same worker job that alerts on a dead phone alerts on a dead bridge.

This is deliberate, and it is the reason the bridge is safe to run at all: there
is no state in which it looks fine while silently returning nothing. It also
raises an explicit `bridge_session_lost` event on the way into a fault, because
that is the only signal that can say *why*, but the heartbeat gap is the one
that is load-bearing.

## Running it

1. Enable the flag. The process refuses to start without it:

   ```
   FEATURE_MESSAGES_BRIDGE=true
   ```

2. Install the browser once:

   ```bash
   pnpm --filter @jomma/bridge exec playwright install chromium
   ```

3. On the Accounts page, add a device to the receiving account you want the
   bridge to file captures against. Note its id and its one-time provisioning
   token.

4. Pair the session. This opens a real window and waits for a human:

   ```bash
   pnpm --filter @jomma/bridge pair
   ```

5. Start it once with the provisioning values, then remove them — the device
   token is written to the state file and the one-time value is burned:

   ```bash
   BRIDGE_DEVICE_ID=... BRIDGE_PROVISIONING_TOKEN=jmp_... pnpm --filter @jomma/bridge start
   ```

6. From then on:

   ```bash
   pnpm --filter @jomma/bridge start
   ```

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `FEATURE_MESSAGES_BRIDGE` | `false` | Required. The process exits without it. |
| `BRIDGE_BASE_URL` | `APP_URL` | Where Jomma is. |
| `BRIDGE_STATE_DIR` | `./.bridge` | Chromium profile and state file. |
| `BRIDGE_POLL_SECONDS` | `20` | How often to look for new messages. |
| `BRIDGE_HEARTBEAT_SECONDS` | `300` | Matches the Android app. |
| `BRIDGE_HEADED` | `false` | Show the window. |
| `BRIDGE_SENDER_PATTERN` | `^(bkash\|nagad)$` | Which conversations are read at all. |
| `BRIDGE_DEVICE_ID` | — | First boot only. |
| `BRIDGE_PROVISIONING_TOKEN` | — | First boot only. |

## Handle the state directory like a credential

`BRIDGE_STATE_DIR` holds a live Messages pairing and the device token. Anyone
with a copy of that directory can read the account's messages and file captures.
It is in `.gitignore`; keep it off shared storage.

## What it deliberately does not parse

Nothing. The raw message text is forwarded verbatim and the server parses it.
A second parser living out here would drift from the real one and the two would
disagree at the worst possible moment.
