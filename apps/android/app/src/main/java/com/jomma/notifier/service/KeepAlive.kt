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
            /*
             * Honor first, and as its own package.
             *
             * Honor separated from Huawei in 2020 and MagicOS ships
             * `com.hihonor.systemmanager`. The Huawei package often still
             * exists on those phones as a leftover, so matching it first
             * resolved *something* and opened the wrong screen entirely —
             * reported as "app launch goes to the wrong settings". The one
             * people are told to find is Settings → Battery → App launch,
             * which is `StartupNormalAppListActivity` under whichever of the
             * two packages this phone actually uses.
             */
            "com.hihonor.systemmanager" to "com.hihonor.systemmanager.startupmgr.ui.StartupNormalAppListActivity",
            "com.hihonor.systemmanager" to "com.hihonor.systemmanager.appcontrol.activity.StartupAppControlActivity",
            // Huawei — EMUI, and pre-split Honor hardware.
            "com.huawei.systemmanager" to "com.huawei.systemmanager.startupmgr.ui.StartupNormalAppListActivity",
            "com.huawei.systemmanager" to "com.huawei.systemmanager.appcontrol.activity.StartupAppControlActivity",
            // "Protected apps" — an older EMUI screen, and a different one.
            // Last, so it never wins over App launch.
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

        /*
         * Two passes, and the second one is the point.
         *
         * `resolveActivity` matches activities this app is not allowed to
         * start, and launching one throws `SecurityException`. Returning the
         * first *resolvable* candidate therefore let an unlaunchable entry beat
         * the screen people actually need — the caller fell through to app
         * details and the remaining candidates were never tried.
         *
         * Preferring an exported one fixes that. Requiring it would not: these
         * are undocumented vendor internals on ROMs going back years, and an
         * old phone that reports `exported = false` for an activity that starts
         * perfectly well would be left with no vendor screen at all. Those
         * phones are the ones that need this most, so the fallback keeps the
         * original behaviour — hand back the best guess and let the caller's
         * `runCatching` deal with a refusal.
         */
        val resolved = candidates.mapNotNull { (pkg, cls) ->
            val intent = Intent().setComponent(ComponentName(pkg, cls))
            context.packageManager.resolveActivity(intent, 0)?.activityInfo?.let { intent to it }
        }

        val best = resolved.firstOrNull { (_, info) -> info.exported } ?: resolved.firstOrNull()
        return best?.first?.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
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
