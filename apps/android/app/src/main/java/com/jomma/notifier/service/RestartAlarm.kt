package com.jomma.notifier.service

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log
import com.jomma.notifier.data.Prefs

/**
 * A second way back from the dead, independent of WorkManager.
 *
 * The existing watchdog runs in WorkManager, which is the right default: it
 * survives process death and app updates. What it does not survive is a vendor
 * ROM deciding the app is not worth scheduling — Honor, Xiaomi, Oppo and others
 * defer or drop background work for apps they have decided are idle, and the
 * watchdog is then exactly as asleep as the thing it was watching.
 *
 * `AlarmManager` is a different subsystem with different rules. It is not
 * immune, but it fails at different times and for different reasons, and two
 * mechanisms that fail independently are worth far more than one that is
 * slightly better.
 *
 * `setExactAndAllowWhileIdle` because inexact alarms are batched into Doze
 * maintenance windows that can be hours apart on an idle phone. Hours of not
 * capturing is the failure being prevented.
 *
 * This does not make the app unkillable. It makes it come back quickly, which
 * is the achievable version.
 */
object RestartAlarm {

    private const val TAG = "JommaRestart"
    private const val REQUEST_CODE = 4711

    /** Often enough to matter, rarely enough not to be the thing draining the battery. */
    private const val INTERVAL_MS = 10 * 60 * 1000L

    fun schedule(context: Context) {
        val manager = context.getSystemService(AlarmManager::class.java) ?: return
        val at = System.currentTimeMillis() + INTERVAL_MS

        try {
            /*
             * Android 12+ gates exact alarms behind a permission the user has to
             * grant. Rather than demand it, fall back to an inexact alarm: less
             * punctual, still far better than nothing, and it does not make
             * setup harder for a feature that is already a safety net.
             */
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && !manager.canScheduleExactAlarms()) {
                manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pendingIntent(context))
            } else {
                manager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pendingIntent(context))
            }
        } catch (error: SecurityException) {
            // Some ROMs revoke exact-alarm scheduling without warning. An
            // inexact alarm is still worth having, and a crash here would take
            // down the capture path this is meant to protect.
            Log.w(TAG, "exact alarm refused, falling back", error)
            runCatching {
                manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pendingIntent(context))
            }
        }
    }

    fun cancel(context: Context) {
        val manager = context.getSystemService(AlarmManager::class.java) ?: return
        manager.cancel(pendingIntent(context))
    }

    private fun pendingIntent(context: Context): PendingIntent =
        PendingIntent.getBroadcast(
            context,
            REQUEST_CODE,
            Intent(context, Receiver::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

    /**
     * Restarts the service if it is not running, then schedules the next check.
     *
     * Rescheduling from inside the receiver rather than using a repeating alarm
     * is deliberate: a repeating alarm that the system drops once is gone for
     * good, while this re-arms every time it fires.
     */
    class Receiver : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            val prefs = Prefs.get(context)
            if (prefs.livePairings.isNotEmpty() && !NotifierService.isRunning) {
                Log.i(TAG, "service was not running — restarting it")
                runCatching { NotifierService.start(context) }
            }
            schedule(context)
        }
    }
}
