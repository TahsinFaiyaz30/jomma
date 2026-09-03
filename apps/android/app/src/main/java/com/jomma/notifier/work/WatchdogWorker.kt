package com.jomma.notifier.work

import android.content.Context
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.jomma.notifier.capture.NotificationListener
import com.jomma.notifier.data.CaptureRepository
import com.jomma.notifier.data.Prefs
import com.jomma.notifier.net.JommaApi
import com.jomma.notifier.service.NotifierService
import java.util.concurrent.TimeUnit

/**
 * The watchdog.
 *
 * Lives in WorkManager rather than inside the service it is watching, because
 * WorkManager survives process death and app updates and the service does not.
 * Every 15 minutes — Android's floor — it checks the three things that go wrong
 * silently:
 *
 *   - the service has been killed
 *   - notification access has been revoked by an OS update
 *   - the queue is backing up
 */
class WatchdogWorker(context: Context, params: WorkerParameters) :
    CoroutineWorker(context, params) {

    override suspend fun doWork(): Result {
        val context = applicationContext
        val prefs = Prefs.get(context)

        if (!prefs.isProvisioned) return Result.success()

        // The service is the thing keeping the notification listener resident.
        if (!NotifierService.isRunning) {
            NotifierService.start(context)
        }

        // An OS update revoking notification access is common and completely
        // silent. This is the only thing that catches it.
        if (!NotificationListener.hasAccess(context)) {
            JommaApi(context).reportEvent("permission_lost", "notification_listener")
        }

        if (!HeartbeatWorker.hasSmsPermission(context)) {
            JommaApi(context).reportEvent("permission_lost", "sms")
        }

        val repository = CaptureRepository(context)
        if (repository.pendingCount() > 0) {
            FlushWorker.enqueueNow(context)
        }

        repository.prune()

        return Result.success()
    }

    companion object {
        const val PERIODIC_NAME = "jomma-watchdog"

        fun schedule(context: Context) {
            val request = PeriodicWorkRequestBuilder<WatchdogWorker>(15, TimeUnit.MINUTES)
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
    }
}
