package com.jomma.notifier.service

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.lifecycle.LifecycleService
import androidx.lifecycle.lifecycleScope
import com.jomma.notifier.R
import com.jomma.notifier.data.CaptureRepository
import com.jomma.notifier.data.Prefs
import com.jomma.notifier.ui.MainActivity
import com.jomma.notifier.work.FlushWorker
import com.jomma.notifier.work.HeartbeatWorker
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

/**
 * The foreground service.
 *
 * Its persistent notification is ugly and that is the point: visibility is what
 * keeps this process alive, and a foreground service is the strongest signal to
 * Android that it should not be killed.
 *
 * It also drives the five-minute heartbeat, because WorkManager's periodic floor
 * is fifteen and the server alerts on a fifteen-minute gap.
 */
class NotifierService : LifecycleService() {

    private val prefs by lazy { Prefs.get(applicationContext) }
    private val repository by lazy { CaptureRepository(applicationContext) }

    override fun onCreate() {
        super.onCreate()
        createChannel()
        startForeground(NOTIFICATION_ID, buildNotification("Starting…"))
        isRunning = true

        lifecycleScope.launch {
            while (isActive) {
                val queued = runCatching { repository.pendingCount() }.getOrDefault(0)
                updateNotification(queued)

                // Every live number beats. One being revoked or waiting for
                // approval leaves the others reporting.
                for (pairing in prefs.livePairings) {
                    runCatching { HeartbeatWorker.beat(applicationContext, pairing) }
                }
                if (queued > 0 && prefs.livePairings.isNotEmpty()) {
                    FlushWorker.enqueueNow(applicationContext)
                }

                delay(HEARTBEAT_INTERVAL_MS)
            }
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        super.onStartCommand(intent, flags, startId)
        // Re-armed on every start, so the alarm chain cannot be broken by the
        // one restart that happens to fire while the previous alarm was pending.
        RestartAlarm.schedule(applicationContext)
        // Restart if Android kills us. The watchdog is the second line.
        return START_STICKY
    }

    /**
     * Swiping the app out of recents does not mean "stop watching for money".
     *
     * On most vendor ROMs a swipe kills the whole process, service included,
     * and `START_STICKY` alone is not reliably honoured there. Asking to be
     * started again immediately is — and the alarm below covers the case where
     * even this delivery is dropped.
     */
    override fun onTaskRemoved(rootIntent: Intent?) {
        val prefs = Prefs.get(applicationContext)
        if (prefs.livePairings.isNotEmpty()) {
            RestartAlarm.schedule(applicationContext)
            runCatching { start(applicationContext) }
        }
        super.onTaskRemoved(rootIntent)
    }

    override fun onDestroy() {
        isRunning = false
        /*
         * Deliberately *not* cancelled here. onDestroy runs both when the user
         * stops the service on purpose and when the system kills it — and only
         * the second case matters. Cancelling would disarm the recovery exactly
         * when it is needed.
         */
        super.onDestroy()
    }

    private fun updateNotification(queueDepth: Int) {
        val lastBeat = prefs.lastHeartbeatAt
        val ago = if (lastBeat == 0L) "never" else "${(System.currentTimeMillis() - lastBeat) / 1000}s ago"
        val pairings = prefs.pairings
        val live = pairings.count { it.live }

        val text = when {
            pairings.isEmpty() -> "Not provisioned"
            // Named rather than counted when there is one, because "1 number"
            // tells the operator nothing they did not already know.
            live == 0 && pairings.any { it.awaitingApproval } ->
                "Waiting for approval on the dashboard"
            live == 0 -> "Revoked — re-provision this device"
            queueDepth > 0 -> "$queueDepth queued · beat $ago"
            live == 1 -> "Watching ${pairings.first { it.live }.accountMsisdn} · beat $ago"
            else -> "Watching $live numbers · beat $ago"
        }

        val manager = getSystemService(NotificationManager::class.java)
        manager?.notify(NOTIFICATION_ID, buildNotification(text))
    }

    private fun buildNotification(text: String): Notification {
        val open = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("Jomma Notifier")
            .setContentText(text)
            .setSmallIcon(R.drawable.ic_notification)
            .setOngoing(true)
            .setSilent(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setContentIntent(open)
            .build()
    }

    private fun createChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return

        val channel = NotificationChannel(
            CHANNEL_ID,
            "Jomma Notifier",
            NotificationManager.IMPORTANCE_LOW,
        ).apply {
            description = "Keeps the capture service alive"
            setShowBadge(false)
        }
        getSystemService(NotificationManager::class.java)?.createNotificationChannel(channel)
    }

    companion object {
        private const val CHANNEL_ID = "jomma_notifier"
        private const val NOTIFICATION_ID = 1001
        private const val HEARTBEAT_INTERVAL_MS = 5 * 60 * 1000L

        @Volatile
        var isRunning: Boolean = false
            private set

        fun start(context: Context) {
            val intent = Intent(context, NotifierService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
        }
    }
}
