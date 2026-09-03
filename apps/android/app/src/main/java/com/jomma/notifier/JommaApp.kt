package com.jomma.notifier

import android.app.Application
import com.jomma.notifier.data.Prefs
import com.jomma.notifier.service.NotifierService
import com.jomma.notifier.work.HeartbeatWorker
import com.jomma.notifier.work.WatchdogWorker

class JommaApp : Application() {

    override fun onCreate() {
        super.onCreate()

        // Nothing starts until the device has been provisioned — there is
        // nowhere to send anything and no credential to send it with.
        if (Prefs.get(this).isProvisioned) {
            NotifierService.start(this)
            HeartbeatWorker.schedule(this)
            WatchdogWorker.schedule(this)
        }
    }
}
