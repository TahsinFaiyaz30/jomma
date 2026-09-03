# Jomma Notifier — Android app

A single-purpose app that runs on a dedicated phone, captures bKash/Nagad
transaction messages, and forwards them to the Jomma server.

**It never touches money, PINs, or the bKash app itself.** It only reads
notifications and SMS that have already arrived.

The whole system's reliability rests on this app not dying quietly. Everything
below exists to make failure loud.

---

## Stack

```
Kotlin
Jetpack Compose      Minimal UI — status screen and setup only
Room                 Local capture queue. Must survive reboot and force-stop.
WorkManager          Watchdog and retry scheduling
OkHttp               HTTP with exponential backoff
minSdk 26 / target latest stable
```

No analytics, no crash reporter that ships message contents, no third-party SDKs
beyond the above. This device holds buyer phone numbers.

---

## Capture paths

Run **both** simultaneously. They fail independently. Server-side
`unique(trx_id)` deduplicates, so double capture costs nothing.

### 1. NotificationListenerService (primary)

```kotlin
class JommaListener : NotificationListenerService() {
  override fun onNotificationPosted(sbn: StatusBarNotification) {
    if (sbn.packageName !in WATCHED_PACKAGES) return
    val text = extractText(sbn.notification)
    enqueue(Capture(source = "notification", pkg = sbn.packageName, raw = text))
  }
}
```

Watched packages: `com.bKash.customerapp`, Nagad's package id (verify on device —
do not guess it).

Faster than SMS and unaffected by operator delays.

### 2. SMS BroadcastReceiver (secondary)

```kotlin
class SmsReceiver : BroadcastReceiver() {
  override fun onReceive(ctx: Context, intent: Intent) {
    Telephony.Sms.Intents.getMessagesFromIntent(intent)
      .filter { it.originatingAddress in WATCHED_SENDERS }   // "bKash", "NAGAD"
      .forEach { enqueue(Capture(source = "sms", raw = it.messageBody)) }
  }
}
```

Catches the case where a notification is swallowed by an OS update or the bKash
app is force-stopped.

---

## The local queue

**This is the single most important design decision in the app.**

```kotlin
@Entity
data class Capture(
  @PrimaryKey val localId: String = uuid(),
  val source: String,          // notification | sms
  val pkg: String?,
  val raw: String,             // never parsed on-device
  val capturedAt: Long,        // device clock — server treats as display only
  val sent: Boolean = false,
  val attempts: Int = 0,
  val lastError: String? = null,
)
```

Strict ordering, no exceptions:

1. **Write to Room.**
2. Attempt the POST.
3. Mark `sent = true` only on a 2xx response.

Never hold a capture only in memory. A capture that exists solely in a variable
is lost to a crash, a kill, or a reboot.

**Do not parse on the device.** Parsing lives on the server, where you can fix a
broken parser by deploying rather than by shipping an APK to a phone in another
room. The device's only job is capture and delivery.

**Never delete unsent captures.** Retain sent ones for 30 days for debugging,
then prune.

### Flush

- Immediately on capture.
- Every 60 seconds if `queue_depth > 0`.
- On network becoming available (`ConnectivityManager` callback).
- On `flush_queue` command from a heartbeat response.

Batch the entire pending queue into one request. After an outage this is one call,
not two hundred.

Backoff on failure: 5s, 15s, 60s, 5m, 15m, capped at 15m. Never give up.

---

## Staying alive

The realistic threats are Android killing the process, the user rebooting, and
the OEM being aggressive about background apps.

### Foreground service

```kotlin
startForeground(ID, notification)   // persistent, low priority, not dismissible
```

Shows last capture time and queue depth. Ugly, and that's fine — visibility is
the point. A foreground service is the strongest signal to Android that the
process should live.

### Boot receiver

`RECEIVE_BOOT_COMPLETED` → restart the service. Test this by actually rebooting,
not by assuming it works.

### WorkManager watchdog

Periodic worker every 15 minutes (Android's floor):

```kotlin
if (!isServiceRunning()) restartService()
if (!hasNotificationAccess()) reportEvent("permission_lost")
if (queueDepth() > 0) attemptFlush()
```

WorkManager survives process death and app updates, which is why the watchdog
lives there rather than inside the service it's watching.

### Battery optimization

On first run, walk the user through `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`. On
Xiaomi, Oppo, Vivo, and Samsung, also point them at the OEM's own autostart
settings — these override standard Android behaviour and are the most common
cause of a silently dead notifier.

Re-check on every launch. If optimization has been re-enabled, show a blocking
warning and report it to the server.

### Permission self-check

On every launch and on every watchdog tick, verify notification access and SMS
permission. If either is missing, POST a `permission_lost` event **and** show a
persistent in-app warning. An OS update revoking notification access is a common
and completely silent failure.

---

## Heartbeat

Every 5 minutes, unconditionally, whether or not there is anything to send.

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

The heartbeat is not telemetry. It is the mechanism by which the server learns
the phone is alive. A 15-minute gap triggers a critical alert.

The response may carry commands: `flush_queue`, `resend_since`, `rotate_token`,
`stop`. Handle unknown command types by ignoring them, so the server can add new
ones without an app update.

---

## Provisioning

1. Dashboard → Accounts → Add device. Shows a QR code containing server URL, a
   one-time provisioning token, and the receiving account id.
2. App scans it, exchanges the one-time token for a long-lived device token.
3. Device token stored in `EncryptedSharedPreferences`.
4. Server marks the device active; the dashboard shows it awaiting first
   heartbeat.

Rotation: the server can issue `rotate_token` on a heartbeat. The app swaps and
acknowledges. Revocation from the dashboard is immediate and the app then shows a
"revoked, re-provision me" screen rather than failing silently.

---

## App UI

Four screens. Compose. Deliberately plain — nobody uses this app, they check it.

**Status (home).** One glance answers "is it working?"

```
┌─────────────────────────────────┐
│  ● Connected                    │   green | amber | red, large
│                                 │
│  Last capture      2 min ago    │
│  Last heartbeat    41 sec ago   │
│  Queue             0 pending    │
│  Battery           87%  charging│
│                                 │
│  Today            34 captured   │
│                                 │
│  [ Send test capture ]          │
└─────────────────────────────────┘
```

The status dot is the whole product. Green means the server has heard from this
device recently and the queue is empty. Amber means the queue is backing up or a
permission is missing. Red means captures are failing or permissions are gone.

**Log.** Recent captures, newest first, with delivery status. Raw text visible,
because when the parser breaks this is where you read what actually arrived. Long
press to copy.

**Setup.** Permission checklist with a live tick or cross against each, and a
button that opens the relevant system settings page. Include the OEM autostart
guidance here.

**About.** Server URL, device id, app version, token rotation status, and a
"re-provision" action.

Use the system font. This is not a place to spend design effort.

---

## Threat handling

| Risk | Mitigation |
|---|---|
| Phone stolen | Screen lock required. Device token in `EncryptedSharedPreferences`. Revoke from dashboard immediately — the token is useless after. |
| Message contents are PII | No third-party analytics. No crash reporter that captures message bodies. Local log retention capped at 30 days. |
| Fake captures POSTed to the server | Device token plus device id, rate limited server-side. A stolen token gets revoked, not trusted. |
| App update breaks capture | Disable Play auto-update on this device. Update manually and watch the log after. |
| OEM kills the app | Foreground service, battery exemption, OEM autostart, WorkManager watchdog, and — ultimately — the server-side heartbeat alert as the backstop. |

---

## The hardware

Treat the phone as infrastructure, not a phone.

- A cheap dedicated Android device, nothing else installed.
- Permanently plugged in, ideally on a small UPS. Power cuts are the most common
  real-world cause of downtime.
- Wired-stable wifi, or a second SIM with data as failover.
- Screen can stay off; the foreground service keeps working.
- Play auto-update disabled.
- **A second device on a second receiving number.** One phone is a single point of
  failure for your entire revenue. Two phones on two numbers, with the server
  routing around an unhealthy account, is the difference between a bad hour and a
  bad day.

---

## Build order

1. Room entity, DAO, and the enqueue path
2. NotificationListenerService, capturing to Room only
3. HTTP client, batch flush, backoff
4. Foreground service and boot receiver
5. Heartbeat with command handling
6. WorkManager watchdog and permission self-check
7. SMS receiver as the second path
8. Provisioning by QR, token rotation
9. Status screen, then Log, then Setup

Steps 1–4 are a working notifier. 5–6 are what make it trustworthy. Do not ship
without them.

---

## Before writing any parser

Send ৳10 between two of your own numbers, on both bKash and Nagad, through both
the app and `*247#`. Capture the exact notification text and the exact SMS text
for each combination.

Confirm for each: does the sender's reference appear in the recipient's message?
Is the balance included? What does a cash-in look like versus a send-money?

Save every captured string as a test fixture in `apps/web/lib/parsers/fixtures/`.
The parser is written against those files and nothing else.
