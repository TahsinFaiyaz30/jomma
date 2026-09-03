package com.jomma.notifier.service

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.jomma.notifier.data.Prefs
import com.jomma.notifier.net.JommaApi
import com.jomma.notifier.work.FlushWorker
import com.jomma.notifier.work.HeartbeatWorker
import com.jomma.notifier.work.WatchdogWorker
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

/**
 * Restarts everything after a reboot or an app update.
 *
 * The local queue survives in Room, so anything captured before the reboot goes
 * out as soon as the network is back. Test this by actually rebooting the phone,
 * not by assuming it works.
 */
class BootReceiver : BroadcastReceiver() {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    override fun onReceive(context: Context, intent: Intent) {
        val action = intent.action
        if (action != Intent.ACTION_BOOT_COMPLETED && action != Intent.ACTION_MY_PACKAGE_REPLACED) {
            return
        }

        val appContext = context.applicationContext
        val prefs = Prefs.get(appContext)
        if (!prefs.isProvisioned) return

        NotifierService.start(appContext)
        HeartbeatWorker.schedule(appContext)
        WatchdogWorker.schedule(appContext)
        FlushWorker.enqueueNow(appContext)

        val pending = goAsync()
        scope.launch {
            try {
                // Tell the server the phone came back, so a heartbeat gap in the
                // dashboard has an explanation next to it.
                JommaApi(appContext).reportEvent("boot", "device restarted")
            } finally {
                pending.finish()
            }
        }
    }
}
