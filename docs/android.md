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

1. Dashboard → Accounts → Add device. Shows a QR containing one thing: the URL
   `https://<host>/pair/<code>`.
2. The phone opens it — by the app's own scanner, or by *any* QR scanner, which
   Android routes into the app as a verified App Link.
3. The app exchanges the one-time code for a long-lived device token, stored in
   `EncryptedSharedPreferences`.
4. Server marks the device active; the dashboard shows it awaiting first
   heartbeat.

### Opening the QR from any scanner

The QR is a bare URL so that a general-purpose scanner can act on it. Android
App Links then send it to this app rather than a browser, and — since Android
12 — refuse to let any other app claim the same link. That refusal is the
security property; it is enforced by the OS, not by obscurity.

Two halves, and both must agree:

- **Server.** The fingerprint published at `/.well-known/assetlinks.json`. This
  repository's own release key is the committed default in
  `lib/services/app-links.ts`; `ANDROID_CERT_SHA256` overrides it for a fork
  signing its own APK. A fingerprint is not a secret — being published at that
  URL is its entire purpose.
- **App.** The host is baked into the manifest, because App Links verify against
  a literal host that cannot be discovered at runtime:

  ```
  ./gradlew assembleRelease -PjommaHost=pay.yourshop.com
  ```

  `./gradlew :app:printSigningFingerprint` prints the value to publish, and the
  commands to confirm it took.

Check it landed with `adb shell pm get-app-links com.jomma.notifier`, which
should report `verified` for your host.

### Verification lags, so there is a second path

Android does not verify at install time by itself — it asks Google's Digital
Asset Links service, which **caches for an hour**. Change a fingerprint and
`pm get-app-links` will keep reporting failure long after the file is correct.
Confirm what Google currently believes rather than guessing:

```
curl "https://digitalassetlinks.googleapis.com/v1/statements:list?source.web.site=https://<your-host>&relation=delegate_permission/common.handle_all_urls"
```

An empty `{"maxAge": "3600s"}` is a cached negative, not a broken file.

During that window a scanned QR opens a browser. So `/pair/<code>` hands off to
the app itself with an `intent://` URL naming `package=com.jomma.notifier` —
Android delivers that to the notifier or to nothing, with no chooser and no
dependence on verification. Scanning with another app therefore reaches the
notifier either way: directly once verified, via a browser bounce until then.

Not a `jomma://` scheme, deliberately. Any app can claim a custom scheme; an
explicit package cannot be claimed by anyone else.

What the QR does *not* contain: a token, a device id, an account number, or a
label. All of that used to be in it as plain JSON, which any scanner would
happily display. The code is still redeemable by whoever holds it for fifteen
minutes — the improvement is that nothing legible leaks, and the payload is
inert without the server.

Rotation: the server can issue `rotate_token` on a heartbeat. The app swaps and
acknowledges. Revocation from the dashboard is immediate and the app then shows a
"revoked, re-provision me" screen rather than failing silently.

### Scanning

CameraX for the preview, ML Kit for the decode, both in a Compose screen inside
`MainActivity` — see `ui/ScannerScreen.kt` and `capture/QrDecoder.kt`.

Two ways in, because the code is not always in front of the camera:

- **Point the phone at it.** The usual case: the dashboard is open on a laptop
  next to the phone.
- **Pick a saved image.** Often the QR arrives as a screenshot someone was sent,
  and there was previously no way to use one short of displaying it on a second
  screen. Both paths become an ML Kit `InputImage` and go through one decoder.

The image path uses the **Photo Picker**, not `READ_MEDIA_IMAGES`. The user hands
over one image and the app never gets to see the gallery — a much smaller
permission than the job needs, on a device that already holds customer data.

Declining the camera is not a dead end. Reading a saved image needs no camera at
all, so the screen says so and keeps working.

A successful scan is delivered **once**. The camera keeps producing frames while
the code is still in view, and provisioning burns a one-time token — a second
call would come back "already used" and report a failure for a scan that worked.

> This replaced `zxing-android-embedded`, which could not read a QR out of a
> picked image, decoded angled and low-light codes far less reliably, and shipped
> an Activity pinned to `screenOrientation="sensorLandscape"` in its own
> manifest. That last one rotated the phone into landscape to scan and no runtime
> option could override it.

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
