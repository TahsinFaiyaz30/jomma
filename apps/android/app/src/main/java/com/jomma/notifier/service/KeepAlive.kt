package com.jomma.notifier.service

import android.annotation.SuppressLint
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings

/**
 * Staying alive on a phone that would rather you did not.
 *
 * There is no such thing as an unkillable Android app, and anything claiming
 * otherwise is selling something. What there is: a set of permissions and
 * vendor settings that, together, make being killed rare and recovery fast.
 * This is the checklist, and whether each item is actually satisfied.
 *
 * The one that catches people is [autoStartIntent]. Turning off battery
 * optimisation is the advice everywhere, and on a stock Pixel it is enough. On
 * Honor, Huawei, Xiaomi, Oppo, Vivo and Samsung it is not: those ROMs run a
 * *second* manager, unrelated to Android's, which kills background apps
 * regardless of what Android's own battery settings say. It is off by default,
 * it is buried, and nothing in the standard settings hints that it exists.
 *
 * For a device whose only job is watching for incoming money, that setting is
 * the difference between working and quietly not.
 */
object KeepAlive {

    /**
     * Whether Android has been told to leave this app alone.
     *
     * Worth checking rather than assuming: the app previously opened the
     * system's battery-optimisation *list* and never looked at the result, so
     * "I turned it off" and "it is off for this app" were different claims that
     * nobody could tell apart.
     */
    fun isBatteryOptimisationDisabled(context: Context): Boolean {
        val power = context.getSystemService(PowerManager::class.java) ?: return false
        return power.isIgnoringBatteryOptimizations(context.packageName)
    }

    /**
     * Asks for the exemption directly, as a dialog, for this app.
     *
     * `ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` names the package, so the
     * user answers one question. The alternative — and what this app used to do
     * — opens a list of every installed app and hopes the right one is found,
     * which is how you end up believing you granted something you did not.
     *
     * Flagged `@SuppressLint`: Play Store restricts this permission, and this
     * app is not on the Play Store. It is installed deliberately on a phone
     * whose entire purpose is to stay awake and forward payment messages.
     */
    @SuppressLint("BatteryLife")
    fun requestBatteryExemption(context: Context): Intent =
        Intent(
            Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
            Uri.parse("package:${context.packageName}"),
        )

    /**
     * The vendor's own background-app manager, if this phone has one.
     *
     * Every one of these is a private activity that the manufacturer can rename
     * or remove in any update, so each is tried in turn and the whole thing
     * degrades to the ordinary app-info screen. A dead end here is a nuisance;
     * a crash would be worse than the problem being solved.
     *
     * Ordered by how much trouble the vendor causes in practice.
     */
    fun autoStartIntent(context: Context): Intent? {
        val candidates = listOf(
            // Honor and Huawei — "App launch", the single most common cause of
            // a foreground service dying on these phones despite every Android
            // setting being correct.
            "com.huawei.systemmanager" to "com.huawei.systemmanager.startupmgr.ui.StartupNormalAppListActivity",
            "com.huawei.systemmanager" to "com.huawei.systemmanager.appcontrol.activity.StartupAppControlActivity",
            "com.huawei.systemmanager" to "com.huawei.systemmanager.optimize.process.ProtectActivity",
            // Xiaomi / Redmi / POCO — "Autostart".
            "com.miui.securitycenter" to "com.miui.permcenter.autostart.AutoStartManagementActivity",
            // Oppo / Realme.
            "com.coloros.safecenter" to "com.coloros.safecenter.permission.startup.StartupAppListActivity",
            "com.coloros.safecenter" to "com.coloros.safecenter.startupapp.StartupAppListActivity",
            "com.oppo.safe" to "com.oppo.safe.permission.startup.StartupAppListActivity",
            // Vivo / iQOO.
            "com.vivo.permissionmanager" to "com.vivo.permissionmanager.activity.BgStartUpManagerActivity",
            "com.iqoo.secure" to "com.iqoo.secure.ui.phoneoptimize.BgStartUpManager",
            // Samsung — "Sleeping apps"; the app must not be listed there.
            "com.samsung.android.lool" to "com.samsung.android.sm.ui.battery.BatteryActivity",
            // Asus.
            "com.asus.mobilemanager" to "com.asus.mobilemanager.autostart.AutoStartActivity",
        )

        for ((pkg, cls) in candidates) {
            val intent = Intent().setComponent(ComponentName(pkg, cls))
            // resolveActivity rather than a try/catch around startActivity: a
            // vendor activity that exists but refuses to launch should fall
            // through to the next candidate, not throw at the user.
            if (context.packageManager.resolveActivity(intent, 0) != null) {
                return intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
        }
        return null
    }

    /** Where to send someone when this phone has no recognisable manager. */
    fun appDetailsIntent(context: Context): Intent =
        Intent(
            Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
            Uri.parse("package:${context.packageName}"),
        ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)

    /**
     * Whether this phone is one of the aggressive ones.
     *
     * Used only to decide how loudly to point at the vendor setting. Being
     * wrong in either direction costs nothing but emphasis.
     */
    val isAggressiveVendor: Boolean
        get() = Build.MANUFACTURER.lowercase() in setOf(
            "honor", "huawei", "xiaomi", "redmi", "poco",
            "oppo", "realme", "oneplus", "vivo", "iqoo",
            "samsung", "asus", "meizu", "tecno", "infinix",
        )

    /** For the UI, so the instruction can name the phone rather than generalise. */
    val vendorLabel: String
        get() = Build.MANUFACTURER.replaceFirstChar { it.uppercase() }
}
