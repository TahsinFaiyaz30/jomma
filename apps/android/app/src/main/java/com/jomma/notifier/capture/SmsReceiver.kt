package com.jomma.notifier.capture

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.provider.Telephony
import com.jomma.notifier.data.CaptureRepository
import com.jomma.notifier.work.FlushWorker
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

/**
 * The second capture path.
 *
 * Runs alongside the notification listener, not instead of it. It catches the
 * case where a notification is swallowed by an OS update or the bKash app has
 * been force-stopped. Duplicates cost nothing — the server deduplicates on
 * `trx_id`, and dual capture is the point.
 */
class SmsReceiver : BroadcastReceiver() {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Telephony.Sms.Intents.SMS_RECEIVED_ACTION) return

        val messages = Telephony.Sms.Intents.getMessagesFromIntent(intent) ?: return

        // A long message arrives as several parts; concatenate by sender so the
        // server sees one whole message rather than fragments.
        val bySender = messages
            .filter { it.originatingAddress != null }
            .groupBy { it.originatingAddress!! }

        val appContext = context.applicationContext
        val repository = CaptureRepository(appContext)
        val pending = goAsync()

        scope.launch {
            try {
                var stored = false
                for ((sender, parts) in bySender) {
                    if (!isWatched(sender)) continue
                    val body = parts.joinToString("") { it.messageBody.orEmpty() }
                    if (repository.enqueue(source = "sms", raw = body, pkg = null)) stored = true
                }
                if (stored) FlushWorker.enqueueNow(appContext)
            } finally {
                pending.finish()
            }
        }
    }

    private fun isWatched(sender: String): Boolean =
        WATCHED_SENDERS.any { sender.contains(it, ignoreCase = true) }

    companion object {
        /**
         * Alphanumeric sender ids. Nagad's must be confirmed on a real device
         * before it is added rather than assumed.
         */
        val WATCHED_SENDERS = setOf("bKash")
    }
}
