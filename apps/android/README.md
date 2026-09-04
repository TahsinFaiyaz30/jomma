# Jomma Notifier — Android

Captures bKash/Nagad transaction messages on a dedicated phone and forwards them
to the Jomma server. It never touches money, PINs, or the bKash app itself — it
only reads notifications and SMS that have already arrived.

Spec: [docs/android.md](../../docs/android.md).

---

## What has and hasn't been verified

**Built and run.** It compiles to a ~14 MB APK, installs on an API 36 emulator,
launches, and renders all three screens with no crash in logcat. Material You
dynamic colour is working — the app takes its palette from the wallpaper.

**Not verified on real hardware, and that is the part that matters.** An emulator
has no bKash app, no SIM, and no camera to scan a provisioning QR with, so none
of the following has ever actually run:

- capturing a real notification or SMS
- the Room queue surviving a reboot
- the foreground service surviving an OEM's battery killer
- provisioning by QR
- token rotation on a live device

The server side of every one of those *is* verified against a real database —
provisioning, capture, dedupe, heartbeat, command delivery and rotation all have
passing tests. So the contract is known-good; it is the device half that is
unproven.

Before trusting it:

1. Sideload onto the dedicated phone.
2. Grant notification access, SMS, and the battery exemption from the Setup tab.
3. Provision by scanning the QR from **Accounts → Add device** in the dashboard.
4. Send a real ৳10 transfer and watch it land in the Feed.
5. **Reboot the phone** and confirm it comes back on its own. Do not assume.
6. Leave it overnight and check the dashboard has not raised a heartbeat gap.

---

## Build

```bash
cd apps/android
./gradlew assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

Needs JDK 17+ and an Android SDK with platform 37. Android Studio's bundled JBR
works:

```bash
export JAVA_HOME="/c/Program Files/Android/Android Studio/jbr"
```

`local.properties` is machine-local and gitignored. If you need to write one by
hand, **use forward slashes** — a Java properties file treats a single backslash
as an escape, so `C:\Users\...` parses to `C:Users...` and the build fails with
an unhelpful "Invalid file path":

```properties
sdk.dir=C:/Users/you/AppData/Local/Android/Sdk
```

### Versions

AGP 9.4 / Gradle 9.7.1 / Kotlin 2.3.21 / compileSdk 37, minSdk 26. That stack is
not arbitrary — it is the oldest one that builds against the SDK platform Android
Studio installs today. AGP 9 has Kotlin support built in, so there is
deliberately no `kotlin-android` plugin; adding one back will fail the build.

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
