package com.jomma.notifier.work

import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.BatteryManager
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.jomma.notifier.BuildConfig
import com.jomma.notifier.capture.NotificationListener
import com.jomma.notifier.data.CaptureRepository
import com.jomma.notifier.data.Pairing
import com.jomma.notifier.data.Prefs
import com.jomma.notifier.net.PairingLink
import com.jomma.notifier.data.SimInventory
import com.jomma.notifier.net.HeartbeatRequest
import com.jomma.notifier.net.JommaApi
import java.util.concurrent.TimeUnit

/**
 * The heartbeat.
 *
 * Not telemetry. It is the mechanism by which the server learns the phone is
 * alive, and a fifteen-minute gap raises a critical alert. It runs whether or
 * not there is anything to send, because silence is the signal.
 *
 * WorkManager's floor for periodic work is 15 minutes, which is longer than the
 * five the spec asks for, so the foreground service also beats on its own timer.
 * This exists as the backstop for when the service has been killed.
 */
class HeartbeatWorker(context: Context, params: WorkerParameters) :
    CoroutineWorker(context, params) {

    override suspend fun doWork(): Result {
        val prefs = Prefs.get(applicationContext)
        if (prefs.livePairings.isEmpty()) return Result.success()

        /*
         * Every number beats, and one failing does not stop the rest. A silent
         * device raises a critical alert on the server, so skipping the others
         * because the first was offline would report two numbers as dead when
         * only one is.
         */
        var retry = false
        for (pairing in prefs.livePairings) {
            val outcome = beat(applicationContext, pairing)
            if (outcome is JommaApi.Result.Failed && outcome.retryable) retry = true
        }

        return if (retry) Result.retry() else Result.success()
    }

    companion object {
        const val PERIODIC_NAME = "jomma-heartbeat"

        fun schedule(context: Context) {
            val request = PeriodicWorkRequestBuilder<HeartbeatWorker>(15, TimeUnit.MINUTES)
                .setConstraints(
                    Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build(),
                )
                .build()

            WorkManager.getInstance(context).enqueueUniquePeriodicWork(
                PERIODIC_NAME,
                ExistingPeriodicWorkPolicy.KEEP,
                request,
            )
        }

        /**
         * Redeems a number the dashboard chose for this phone.
         *
         * The same call the scanner makes, deliberately. Adding a number from a
         * browser and adding one by scanning a code end at the same claim, so
         * there is one place where a pairing code is burned and one definition
         * of what a new pairing looks like — including that it starts waiting
         * for approval like any other.
         *
         * Refusals are silent because the command has already been drained: a
         * code that was claimed on a previous beat, or has expired, is not a
         * thing to alarm anybody about. The dashboard shows the account as
         * still pending, which is the honest signal and is already on screen.
         */
        private suspend fun claimAddedAccount(context: Context, link: PairingLink) {
            val prefs = Prefs.get(context)
            when (val result = JommaApi(context).pair(link)) {
                is JommaApi.Result.Ok -> {
                    // An `add_account` code is minted for an account that
                    // exists, so this is never null in practice. Skipping
                    // beats storing a pairing with no number, which would
                    // heartbeat forever and watch nothing.
                    val msisdn = result.value.account?.msisdn ?: return
                    // Guard the same way the scanner does: a second pairing for
                    // a number this phone already watches would double every
                    // capture from it.
                    if (prefs.watches(msisdn)) return

                    prefs.upsertPairing(
                        Pairing(
                            deviceId = result.value.deviceId,
                            deviceToken = result.value.deviceToken,
                            serverUrl = link.serverUrl,
                            accountMsisdn = msisdn,
                            provider = result.value.account?.provider,
                            awaitingApproval = true,
                        ),
                    )
                }

                else -> Unit
            }
        }

        /**
         * Sends one heartbeat and handles whatever comes back.
         *
         * Unknown command types are ignored on purpose so the server can add new
         * ones without an app update.
         */
        suspend fun beat(context: Context, pairing: Pairing): JommaApi.Result<*> {
            val prefs = Prefs.get(context)
            val repository = CaptureRepository(context)
            val api = JommaApi(context, pairing)

            val result = api.heartbeat(
                HeartbeatRequest(
                    battery = batteryLevel(context),
                    charging = isCharging(context),
                    network = networkType(context),
                    queueDepth = repository.pendingCount(),
                    permissions = mapOf(
                        "notification_listener" to NotificationListener.hasAccess(context),
                        "sms" to hasSmsPermission(context),
                    ),
                    appVersion = BuildConfig.VERSION_NAME,
                    // Null when the permission is missing, so the server does
                    // not read "could not look" as "there are none".
                    sendingEnabled = pairing.sendingEnabled,
                    sims = if (SimInventory.hasPermission(context)) {
                        SimInventory.read(context).map { it.toReport() }
                    } else {
                        null
                    },
                ),
            )

            /*
             * A phone that has scanned but not been approved is not broken and
             * has nothing to report. Recording the beat would also be a lie —
             * the server rejected it.
             */
            if (result is JommaApi.Result.AwaitingApproval) {
                prefs.updatePairing(pairing.deviceId) { it.copy(awaitingApproval = true) }
                return result
            }

            if (result is JommaApi.Result.Ok) {
                val now = System.currentTimeMillis()
                prefs.lastHeartbeatAt = now
                prefs.updatePairing(pairing.deviceId) {
                    // A successful beat is proof of approval, so this is also
                    // how a phone learns it was approved while it was waiting.
                    it.copy(lastHeartbeatAt = now, awaitingApproval = false)
                }

                // Null when talking to a server too old to send them. Leaving the
                // cache alone is right: overwriting it with defaults would flip
                // the settings screen to "keep nothing" on a downgrade.
                result.value.capture?.let { settings ->
                    prefs.updatePairing(pairing.deviceId) { it.copy(capture = settings) }
                }

                for (command in result.value.commands) {
                    when (command.type) {
                        "flush_queue", "resend_since" -> FlushWorker.enqueueNow(context)

                        /*
                         * Swap the token using the one we still hold. The old
                         * token stays valid until this succeeds, so a failed
                         * rotation leaves the device working — it will be asked
                         * again on the next heartbeat.
                         */
                        "rotate_token" -> {
                            when (val rotated = api.rotateToken()) {
                                is JommaApi.Result.Ok ->
                                    prefs.updatePairing(pairing.deviceId) {
                                        it.copy(deviceToken = rotated.value.deviceToken)
                                    }
                                JommaApi.Result.Revoked ->
                                    prefs.updatePairing(pairing.deviceId) { it.copy(revoked = true) }
                                JommaApi.Result.AwaitingApproval -> Unit
                                is JommaApi.Result.Failed -> Unit // Try again next beat.
                            }
                        }

                        // Scoped to this number. The old app-wide flag stopped
                        // every number on the phone.
                        "stop" ->
                            prefs.updatePairing(pairing.deviceId) { it.copy(revoked = true) }

                        /*
                         * A number was chosen for this phone on the dashboard.
                         *
                         * Claimed here rather than waiting for somebody to open
                         * the app: the whole point is that choosing a SIM in a
                         * browser sets the phone up, and a phone in a drawer is
                         * exactly the phone this has to work for.
                         *
                         * Nothing is trusted from the command but the URL, and
                         * that goes through the same parse and the same claim
                         * as a scanned code. A duplicate delivery finds the code
                         * already burned and fails harmlessly.
                         */
                        "add_account" -> {
                            val link = command.pairUrl?.let { PairingLink.parse(it) }
                            if (link != null) claimAddedAccount(context, link)
                        }

                        else -> Unit // Unknown command — ignore, do not crash.
                    }
                }
            }

            return result
        }

        private fun batteryLevel(context: Context): Int? {
            val intent = context.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
                ?: return null
            val level = intent.getIntExtra(BatteryManager.EXTRA_LEVEL, -1)
            val scale = intent.getIntExtra(BatteryManager.EXTRA_SCALE, -1)
            if (level < 0 || scale <= 0) return null
            return (level * 100) / scale
        }

        private fun isCharging(context: Context): Boolean? {
            val intent = context.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
                ?: return null
            val status = intent.getIntExtra(BatteryManager.EXTRA_STATUS, -1)
            return status == BatteryManager.BATTERY_STATUS_CHARGING ||
                status == BatteryManager.BATTERY_STATUS_FULL
        }

        private fun networkType(context: Context): String {
            val manager = context.getSystemService(ConnectivityManager::class.java)
                ?: return "unknown"
            val capabilities = manager.getNetworkCapabilities(manager.activeNetwork)
                ?: return "none"

            return when {
                capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> "wifi"
                capabilities.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) -> "mobile"
                else -> "unknown"
            }
        }

        fun hasSmsPermission(context: Context): Boolean =
            context.checkSelfPermission(android.Manifest.permission.RECEIVE_SMS) ==
                android.content.pm.PackageManager.PERMISSION_GRANTED
    }
}
