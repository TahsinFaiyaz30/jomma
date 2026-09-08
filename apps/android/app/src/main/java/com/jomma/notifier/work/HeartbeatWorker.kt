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

    override suspend fun doWork(): Result =
        if (beatAll(applicationContext)) Result.retry() else Result.success()

    companion object {
        const val PERIODIC_NAME = "jomma-heartbeat"

        /**
         * Beats every pairing that should be beaten. The only such decision.
         *
         * There are four callers — this worker, the foreground service, the
         * service's watchdog path and the screen — and each used to pick its own
         * list. Every one of them picked `livePairings`, and every one was
         * wrong in the same way, because `live` excludes a pairing that is still
         * waiting for approval and [beat] is the only thing that clears that
         * flag. So a phone that had scanned never beat from anywhere: it could
         * not learn it had been approved, and it never reported the SIMs the
         * dashboard needed in order to offer a number.
         *
         * That bug was fixed one call site at a time, twice, and reappeared from
         * the site nobody had looked at yet. Now no caller chooses: they ask for
         * a sweep and get the right set by construction.
         *
         * Returns whether anything failed in a way worth retrying. One number
         * failing never stops the rest — a silent device raises a critical alert
         * on the server, so giving up after the first offline one would report
         * two numbers as dead when only one is.
         */
        suspend fun beatAll(context: Context): Boolean {
            val prefs = Prefs.get(context)
            var retry = false
            for (pairing in prefs.beatingPairings) {
                val outcome = runCatching { beat(context, pairing) }.getOrNull()
                if (outcome is JommaApi.Result.Failed && outcome.retryable) retry = true
            }
            return retry
        }

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
         * of what a new pairing looks like.
         *
         * Approval is the one thing that differs, and the server decides it: a
         * code that arrived down this channel was minted for *this* handset, so
         * if it has been approved here before it stays approved. Choosing a SIM
         * used to put the phone back in the approval queue, which asked the
         * operator to vouch a second time for the handset in their hand.
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
                            businessId = result.value.business?.id,
                            businessName = result.value.business?.name,
                            accountMsisdn = msisdn,
                            provider = result.value.account?.provider,
                            /*
                             * What the server said, not an assumption.
                             *
                             * This code was queued as a command and delivered
                             * over this phone's own heartbeat, so the server
                             * already knows which handset is redeeming it — and
                             * if it approved that handset once, it says so here
                             * rather than sending the operator back to the
                             * dashboard to approve a phone they just approved.
                             */
                            awaitingApproval = result.value.awaitingApproval,
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
                    it.copy(
                        lastHeartbeatAt = now,
                        awaitingApproval = false,
                        /*
                         * Backfilled, not overwritten with null.
                         *
                         * A phone paired before the app stored the business has
                         * none, and this is how it gets one without being paired
                         * again. A server too old to send it leaves what is
                         * already there rather than erasing the name.
                         */
                        businessId = result.value.business?.id ?: it.businessId,
                        businessName = result.value.business?.name ?: it.businessName,
                    )
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

                        /*
                         * The dashboard reaching the switch that lives here.
                         *
                         * Somebody whose phone is paused and in a drawer has no
                         * other way to resume it. Applied on the handset rather
                         * than written straight to the server row, because the
                         * phone is the thing that must actually stop or start
                         * capturing — setting the column alone would have the
                         * dashboard say resumed while this went on refusing.
                         *
                         * The next beat carries the new value back, so the two
                         * agree without a second round trip.
                         */
                        "set_sending" -> command.enabled?.let { on ->
                            prefs.updatePairing(pairing.deviceId) { it.copy(sendingEnabled = on) }
                            // Paused means nothing is held, here as much as when
                            // the switch is thrown on the phone itself.
                            if (!on) repository.clearFor(pairing.deviceId)
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
