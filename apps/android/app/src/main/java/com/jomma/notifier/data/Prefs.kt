package com.jomma.notifier.data

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import com.jomma.notifier.net.CaptureSettings

/**
 * Device credentials and settings.
 *
 * The device token lives in `EncryptedSharedPreferences`, per docs/android.md.
 * A stolen phone should not hand over a working capture credential to anyone who
 * can read the filesystem — and revoking from the dashboard makes it useless
 * either way.
 */
class Prefs private constructor(private val prefs: SharedPreferences) {

    var serverUrl: String?
        get() = prefs.getString(KEY_SERVER_URL, null)
        set(value) = prefs.edit().putString(KEY_SERVER_URL, value).apply()

    var deviceToken: String?
        get() = prefs.getString(KEY_DEVICE_TOKEN, null)
        set(value) = prefs.edit().putString(KEY_DEVICE_TOKEN, value).apply()

    var deviceId: String?
        get() = prefs.getString(KEY_DEVICE_ID, null)
        set(value) = prefs.edit().putString(KEY_DEVICE_ID, value).apply()

    var accountMsisdn: String?
        get() = prefs.getString(KEY_ACCOUNT_MSISDN, null)
        set(value) = prefs.edit().putString(KEY_ACCOUNT_MSISDN, value).apply()

    var lastHeartbeatAt: Long
        get() = prefs.getLong(KEY_LAST_HEARTBEAT, 0)
        set(value) = prefs.edit().putLong(KEY_LAST_HEARTBEAT, value).apply()

    /** Set when the server answers 401 — the app then asks to be re-provisioned. */
    var revoked: Boolean
        get() = prefs.getBoolean(KEY_REVOKED, false)
        set(value) = prefs.edit().putBoolean(KEY_REVOKED, value).apply()

    /**
     * The last capture settings the server sent, so the settings screen has
     * something to draw before its refresh lands.
     *
     * A cache and nothing more. The account row is the truth — this phone does
     * not act on these values at all, because it does no parsing and so has no
     * way to know what type a message is. Filtering happens on the server, where
     * the one copy of the grammar lives.
     */
    var capture: CaptureSettings
        get() = CaptureSettings(
            cashIn = prefs.getBoolean(KEY_CAPTURE_CASH_IN, false),
            outgoing = prefs.getBoolean(KEY_CAPTURE_OUTGOING, false),
            other = prefs.getBoolean(KEY_CAPTURE_OTHER, false),
        )
        set(value) = prefs.edit()
            .putBoolean(KEY_CAPTURE_CASH_IN, value.cashIn)
            .putBoolean(KEY_CAPTURE_OUTGOING, value.outgoing)
            .putBoolean(KEY_CAPTURE_OTHER, value.other)
            .apply()

    val isProvisioned: Boolean
        get() = !serverUrl.isNullOrBlank() && !deviceToken.isNullOrBlank() && !deviceId.isNullOrBlank()

    fun clearCredentials() {
        prefs.edit()
            .remove(KEY_DEVICE_TOKEN)
            .remove(KEY_DEVICE_ID)
            .remove(KEY_ACCOUNT_MSISDN)
            .putBoolean(KEY_REVOKED, false)
            .apply()
    }

    /* ── Updates ─────────────────────────────────────────────────────────── */

    /** How often to look for a new release. See UpdateInterval for the default. */
    var updateInterval: String
        get() = prefs.getString(KEY_UPDATE_INTERVAL, null) ?: "Daily"
        set(value) = prefs.edit().putString(KEY_UPDATE_INTERVAL, value).apply()

    /**
     * Fetch the APK as soon as one is found, rather than when the user says yes.
     *
     * Off by default. It spends someone's data on a file they have not agreed
     * to install yet, which is not a decision to make on their behalf.
     */
    var autoDownloadUpdates: Boolean
        get() = prefs.getBoolean(KEY_AUTO_DOWNLOAD, false)
        set(value) = prefs.edit().putBoolean(KEY_AUTO_DOWNLOAD, value).apply()

    /**
     * Only use an unmetered connection for downloads.
     *
     * On by default, and it applies to downloading rather than checking: the
     * check is a few hundred bytes, the APK is twelve megabytes. This phone
     * often lives on someone's mobile data as its only link.
     */
    var updatesOnUnmeteredOnly: Boolean
        get() = prefs.getBoolean(KEY_UNMETERED_ONLY, true)
        set(value) = prefs.edit().putBoolean(KEY_UNMETERED_ONLY, value).apply()

    var lastUpdateCheckAt: Long
        get() = prefs.getLong(KEY_LAST_UPDATE_CHECK, 0)
        set(value) = prefs.edit().putLong(KEY_LAST_UPDATE_CHECK, value).apply()

    /** The version last offered, so the same one is not announced repeatedly. */
    var lastNotifiedVersion: String?
        get() = prefs.getString(KEY_LAST_NOTIFIED, null)
        set(value) = prefs.edit().putString(KEY_LAST_NOTIFIED, value).apply()

    companion object {
        private const val FILE = "jomma_secure_prefs"
        private const val KEY_SERVER_URL = "server_url"
        private const val KEY_DEVICE_TOKEN = "device_token"
        private const val KEY_DEVICE_ID = "device_id"
        private const val KEY_ACCOUNT_MSISDN = "account_msisdn"
        private const val KEY_LAST_HEARTBEAT = "last_heartbeat"
        private const val KEY_REVOKED = "revoked"
        private const val KEY_CAPTURE_CASH_IN = "capture_cash_in"
        private const val KEY_CAPTURE_OUTGOING = "capture_outgoing"
        private const val KEY_CAPTURE_OTHER = "capture_other"
        private const val KEY_UPDATE_INTERVAL = "update_interval"
        private const val KEY_AUTO_DOWNLOAD = "auto_download_updates"
        private const val KEY_UNMETERED_ONLY = "updates_unmetered_only"
        private const val KEY_LAST_UPDATE_CHECK = "last_update_check"
        private const val KEY_LAST_NOTIFIED = "last_notified_version"

        @Volatile
        private var instance: Prefs? = null

        fun get(context: Context): Prefs =
            instance ?: synchronized(this) {
                instance ?: create(context.applicationContext).also { instance = it }
            }

        private fun create(context: Context): Prefs {
            val masterKey = MasterKey.Builder(context)
                .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
                .build()

            val prefs = EncryptedSharedPreferences.create(
                context,
                FILE,
                masterKey,
                EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
            )
            return Prefs(prefs)
        }
    }
}
