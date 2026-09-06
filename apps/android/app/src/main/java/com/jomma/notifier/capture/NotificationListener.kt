package com.jomma.notifier.capture

import android.app.Notification
import android.content.Context
import android.provider.Settings
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import com.jomma.notifier.data.Attribution
import com.jomma.notifier.data.CaptureRepository
import com.jomma.notifier.data.Prefs
import com.jomma.notifier.work.FlushWorker
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

/**
 * The primary capture path.
 *
 * Faster than SMS and unaffected by operator delays. It is also the one that an
 * OS update can silently revoke, which is why the watchdog re-checks access on
 * every tick and reports `permission_lost`.
 */
class NotificationListener : NotificationListenerService() {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val repository by lazy { CaptureRepository(applicationContext) }

    override fun onNotificationPosted(sbn: StatusBarNotification) {
        if (sbn.packageName !in WATCHED_PACKAGES) return

        val text = extractText(sbn.notification) ?: return

        scope.launch {
            /*
             * Which number this belongs to, decided now: the posting package is
             * the only evidence, and it is gone by the time the queue flushes.
             * No confident answer means no capture — see Attribution.
             */
            val pairing = Attribution.forNotification(
                Prefs.get(applicationContext).pairings,
                sbn.packageName,
            ) ?: return@launch

            val stored = repository.enqueue(
                pairing = pairing,
                source = "notification",
                raw = text,
                pkg = sbn.packageName,
            )
            // Flush immediately. The scheduled flush is the backstop, not the
            // primary path — a buyer is watching a pay page right now.
            if (stored) FlushWorker.enqueueNow(applicationContext)
        }
    }

    /**
     * Notification text lives in several extras depending on the app and the
     * style. Take the longest of them: bKash puts the full message in bigText
     * and a truncated version in text.
     */
    private fun extractText(notification: Notification): String? {
        val extras = notification.extras ?: return null

        val candidates = listOfNotNull(
            extras.getCharSequence(Notification.EXTRA_BIG_TEXT)?.toString(),
            extras.getCharSequence(Notification.EXTRA_TEXT)?.toString(),
            extras.getCharSequence(Notification.EXTRA_SUMMARY_TEXT)?.toString(),
            notification.tickerText?.toString(),
        ).filter { it.isNotBlank() }

        return candidates.maxByOrNull { it.length }
    }

    companion object {
        /**
         * Nagad's package id must be verified on a real device before being
         * added — docs/android.md is explicit about not guessing it.
         */
        // Nagad joins bKash here so a phone watching both gets both streams.
        // Attribution keys off exactly these, so the two lists cannot drift.
        val WATCHED_PACKAGES = setOf("com.bKash.customerapp", "com.konasl.nagad")

        /** There is no runtime permission for this; it is a settings toggle. */
        fun hasAccess(context: Context): Boolean {
            val enabled = Settings.Secure.getString(
                context.contentResolver,
                "enabled_notification_listeners",
            ).orEmpty()
            return enabled.contains(context.packageName)
        }
    }
}
