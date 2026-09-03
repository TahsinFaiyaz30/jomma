# Jomma Notifier — Android

Captures bKash/Nagad transaction messages on a dedicated phone and forwards them
to the Jomma server. It never touches money, PINs, or the bKash app itself — it
only reads notifications and SMS that have already arrived.

Spec: [docs/android.md](../../docs/android.md).

---

## ⚠ This has never been compiled

Written from the spec, but the machine it was written on has no Android SDK, no
Gradle, and Java 8. **Nothing here has been built, installed, or run.** Expect to
fix compile errors on first build — API-level details and library versions are
the likely culprits, not the structure.

The server side it talks to *is* verified end to end: provisioning, capture,
dedupe, heartbeat, and commands all have passing tests against a real database.
So the contract this app codes against is known-good even though the app is not.

Before trusting it:

1. Open in Android Studio, let it sync, fix whatever the compiler says.
2. Sideload onto the dedicated phone.
3. Grant notification access, SMS, and the battery exemption from the Setup tab.
4. Provision by scanning the QR from **Accounts → Add device** in the dashboard.
5. Send a real ৳10 transfer and watch it land in the Feed.
6. **Reboot the phone** and confirm it comes back on its own. Do not assume.

---

## Build

```bash
cd apps/android
./gradlew assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

Needs JDK 17+ and the Android SDK (compileSdk 35, minSdk 26).

---

## What is here

```
data/
  Capture.kt            Room entity — the local queue
  CaptureDao.kt         Queries, including "pending" and 30-day pruning
  CaptureRepository.kt  enqueue → flush → mark sent, in that order
  Prefs.kt              Device token in EncryptedSharedPreferences
capture/
  NotificationListener.kt   Primary path
  SmsReceiver.kt            Second path, fails independently
net/
  JommaApi.kt           OkHttp. Capture, heartbeat, event, provision
  Models.kt             Wire shapes mirroring docs/api.md
service/
  NotifierService.kt    Foreground service + 5-minute heartbeat
  BootReceiver.kt       Restart after reboot or app update
work/
  FlushWorker.kt        Batched send with exponential backoff
  HeartbeatWorker.kt    15-minute backstop, handles server commands
  WatchdogWorker.kt     Service alive? permissions intact? queue draining?
ui/                     Status, Log, Setup. Compose, deliberately plain
```

## The rule that matters

```
1. Write to Room.
2. Attempt the POST.
3. Mark sent only on a 2xx.
```

There is no path in this app that holds a capture only in memory. A capture that
exists solely in a variable is lost to a crash, a kill, or a reboot.

Nothing is parsed on the device. Parsing lives on the server, where a broken
parser is fixed by deploying rather than by shipping an APK to a phone in
another room.

## Still to do

- **Nagad.** Its package id and SMS sender id are both unknown. `WATCHED_PACKAGES`
  and `WATCHED_SENDERS` deliberately contain only bKash rather than a guess —
  see AGENTS.md open decision #2.
- No instrumented tests. The queue ordering and the backoff ladder are the two
  things worth covering first.
