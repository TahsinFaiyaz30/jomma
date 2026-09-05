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
import com.jomma.notifier.data.Prefs
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
        if (!prefs.isProvisioned || prefs.revoked) return Result.success()

        return when (val outcome = beat(applicationContext)) {
            is JommaApi.Result.Ok -> Result.success()
            JommaApi.Result.Revoked -> Result.success()
            is JommaApi.Result.Failed -> if (outcome.retryable) Result.retry() else Result.success()
        }
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
         * Sends one heartbeat and handles whatever comes back.
         *
         * Unknown command types are ignored on purpose so the server can add new
         * ones without an app update.
         */
        suspend fun beat(context: Context): JommaApi.Result<*> {
            val prefs = Prefs.get(context)
            val repository = CaptureRepository(context)
            val api = JommaApi(context)

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
                ),
            )

            if (result is JommaApi.Result.Ok) {
                prefs.lastHeartbeatAt = System.currentTimeMillis()

                // Null when talking to a server too old to send them. Leaving the
                // cache alone is right: overwriting it with defaults would flip
                // the settings screen to "keep nothing" on a downgrade.
                result.value.capture?.let { prefs.capture = it }

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
                                is JommaApi.Result.Ok -> {
                                    prefs.deviceToken = rotated.value.deviceToken
                                }
                                JommaApi.Result.Revoked -> prefs.revoked = true
                                is JommaApi.Result.Failed -> Unit // Try again next beat.
                            }
                        }

                        "stop" -> prefs.revoked = true

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
