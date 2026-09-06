package com.jomma.notifier.update

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.jomma.notifier.R
import com.jomma.notifier.data.Prefs
import com.jomma.notifier.ui.MainActivity
import java.util.concurrent.TimeUnit

/**
 * Looks for a new release while the app is closed.
 *
 * Runs every six hours and decides for itself whether a check is actually due,
 * rather than rescheduling whenever the interval setting changes. WorkManager's
 * periodic floor is fifteen minutes and its scheduling is approximate, so the
 * interval is enforced by comparing timestamps — which also means changing the
 * setting takes effect immediately instead of after the next cycle.
 *
 * A found update raises a notification. Nothing downloads or installs on its
 * own unless the operator has asked for pre-downloading, and even then
 * installing is always their decision.
 */
class UpdateCheckWorker(context: Context, params: WorkerParameters) :
    CoroutineWorker(context, params) {

    override suspend fun doWork(): Result {
        val context = applicationContext
        val prefs = Prefs.get(context)

        if (!Updater.isCheckDue(context)) return Result.success()

        return when (val result = Updater.check(context)) {
            is Updater.CheckResult.Available -> {
                prefs.lastUpdateCheckAt = System.currentTimeMillis()

                // Only announce a version once. A daily check that re-notified
                // every day about an update somebody has decided not to install
                // is how notifications get turned off entirely.
                if (prefs.lastNotifiedVersion != result.update.version) {
                    prefs.lastNotifiedVersion = result.update.version
                    notify(context, result.update)
                }

                if (prefs.autoDownloadUpdates && Updater.canDownloadNow(context)) {
                    Updater.download(context, result.update)
                }
                Result.success()
            }

            is Updater.CheckResult.UpToDate -> {
                prefs.lastUpdateCheckAt = System.currentTimeMillis()
                // Nothing to install, so nothing worth keeping on disk.
                Updater.clearDownloads(context)
                Result.success()
            }

            // Not retried: the next scheduled run is soon enough, and retrying a
            // network failure on a phone with no signal only costs battery.
            is Updater.CheckResult.Failed -> Result.success()
        }
    }

    private fun notify(context: Context, update: AvailableUpdate) {
        val manager = context.getSystemService(NotificationManager::class.java) ?: return

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            manager.createNotificationChannel(
                NotificationChannel(CHANNEL_ID, "Updates", NotificationManager.IMPORTANCE_DEFAULT)
                    .apply { description = "Tells you when a new version is available" },
            )
        }

        val open = PendingIntent.getActivity(
            context,
            1,
            Intent(context, MainActivity::class.java)
                .putExtra(EXTRA_SHOW_UPDATE, true)
                .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )

        manager.notify(
            NOTIFICATION_ID,
            NotificationCompat.Builder(context, CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_notification)
                .setContentTitle("Jomma ${update.version} is available")
                .setContentText("Tap to review and install · ${update.sizeLabel}")
                .setAutoCancel(true)
                .setContentIntent(open)
                .build(),
        )
    }

    companion object {
        const val EXTRA_SHOW_UPDATE = "show_update"
        private const val CHANNEL_ID = "jomma_updates"
        private const val NOTIFICATION_ID = 2001
        private const val PERIODIC_NAME = "jomma-update-check"

        fun schedule(context: Context) {
            val request = PeriodicWorkRequestBuilder<UpdateCheckWorker>(6, TimeUnit.HOURS)
                .setConstraints(
                    Constraints.Builder()
                        // Connected, not unmetered: the check itself is a few
                        // hundred bytes. The download is what respects the
                        // metered setting, and it does so separately.
                        .setRequiredNetworkType(NetworkType.CONNECTED)
                        .build(),
                )
                .build()

            WorkManager.getInstance(context).enqueueUniquePeriodicWork(
                PERIODIC_NAME,
                // KEEP rather than REPLACE: this is called on every launch, and
                // replacing would reset the period each time so a phone opened
                // daily would never actually run it.
                ExistingPeriodicWorkPolicy.KEEP,
                request,
            )
        }

        fun cancel(context: Context) {
            WorkManager.getInstance(context).cancelUniqueWork(PERIODIC_NAME)
        }

        fun dismissNotification(context: Context) {
            context.getSystemService(NotificationManager::class.java)?.cancel(NOTIFICATION_ID)
        }
    }
}
