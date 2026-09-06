package com.jomma.notifier.data

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import kotlinx.serialization.json.Json

/**
 * Device credentials and settings.
 *
 * Tokens live in `EncryptedSharedPreferences`, per docs/android.md. A stolen
 * phone should not hand over a working capture credential to anyone who can
 * read the filesystem — and revoking from the dashboard makes it useless either
 * way.
 *
 * Pairings are a list, stored as JSON. One phone can watch more than one
 * number, each with its own server-issued token and its own capture settings,
 * so nothing here is a single value any more except the settings that really
 * are about the app rather than about a number.
 */
// `internal` rather than private so the unit tests can build one over a fake
// SharedPreferences. Everything real still goes through `Prefs.get`.
class Prefs internal constructor(private val prefs: SharedPreferences) {

    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }

    /* ── Pairings ────────────────────────────────────────────────────────── */

    /**
     * Guards the whole list against interleaved read-modify-write.
     *
     * Every mutator below reads the list, changes one entry and writes the list
     * back. Three threads do that: `HeartbeatWorker` walking the pairings,
     * `FlushWorker` marking one revoked when the server answers 401, and the UI
     * while someone is on the screen. Unlocked, two of those interleaving means
     * the second write is computed from a list it read before the first — so the
     * first is silently discarded. Losing a heartbeat timestamp that way is
     * nothing; losing a pairing someone has just scanned is a phone that reports
     * nothing for a number the dashboard shows as active.
     *
     * `Prefs` is a process singleton, so one lock covers every writer.
     */
    private val lock = Any()

    /**
     * Every number this phone reports for, oldest first.
     *
     * Read and written whole. The list is small — a phone with more than three
     * of these does not exist — and treating it as one value means a partial
     * write cannot leave a pairing half-updated with a token that no longer
     * matches its device id.
     */
    val pairings: List<Pairing> get() = synchronized(lock) { read() }

    /** The ones that can actually report right now. */
    val livePairings: List<Pairing> get() = pairings.filter { it.live }

    fun pairing(deviceId: String): Pairing? = pairings.firstOrNull { it.deviceId == deviceId }

    /** Adds a new pairing, or replaces one for the same device id. */
    fun upsertPairing(pairing: Pairing) = mutate { list ->
        list.filterNot { it.deviceId == pairing.deviceId } + pairing
    }

    /** Applies a change to one pairing without disturbing the others. */
    fun updatePairing(deviceId: String, transform: (Pairing) -> Pairing) = mutate { list ->
        list.map { if (it.deviceId == deviceId) transform(it) else it }
    }

    fun removePairing(deviceId: String) = mutate { list ->
        list.filterNot { it.deviceId == deviceId }
    }

    /** Read, change and write back as one step, so nothing lands in between. */
    private fun mutate(transform: (List<Pairing>) -> List<Pairing>) {
        synchronized(lock) { write(transform(read())) }
    }

    private fun read(): List<Pairing> {
        val raw = prefs.getString(KEY_PAIRINGS, null) ?: return migrateLegacy()
        return runCatching { json.decodeFromString<List<Pairing>>(raw) }
            .getOrElse { quarantine(raw); emptyList() }
    }

    private fun write(value: List<Pairing>) {
        prefs.edit().putString(KEY_PAIRINGS, json.encodeToString(value)).apply()
    }

    /**
     * Keeps a list that would not parse, before anything writes over it.
     *
     * An unreadable blob used to read back as "no pairings", and the very next
     * write — a heartbeat, which needs no user present — would persist that
     * emptiness over the real thing. Device tokens are issued once and never
     * shown again, so that erased them for good: every number silently stopped
     * reporting and the only way back was re-scanning each one.
     *
     * The list still reads as empty, because a blob that will not parse cannot
     * be merged with. What changes is that the original survives, under its own
     * key, so the tokens can be recovered rather than only mourned. Written once
     * — a second failure must not overwrite the first copy with whatever
     * replaced it.
     */
    private fun quarantine(raw: String) {
        if (prefs.contains(KEY_PAIRINGS_UNREADABLE)) return
        prefs.edit().putString(KEY_PAIRINGS_UNREADABLE, raw).apply()
    }

    /**
     * Whether this number is already paired.
     *
     * By msisdn rather than device id: scanning a second code for a number the
     * phone already watches would create a second device row on the server and
     * double every capture from it.
     */
    fun watches(msisdn: String): Boolean = pairings.any { it.accountMsisdn == msisdn }

    val isProvisioned: Boolean get() = pairings.isNotEmpty()

    /**
     * Carries a single-pairing install onto the list format.
     *
     * Runs once, lazily, the first time the list is read on a phone that
     * predates it — so an existing operator's phone keeps working across the
     * update without re-scanning anything. The old keys are left in place
     * rather than cleared: if this rewrite is ever wrong, the evidence is still
     * on the device.
     */
    private fun migrateLegacy(): List<Pairing> {
        val serverUrl = prefs.getString(KEY_SERVER_URL, null)
        val token = prefs.getString(KEY_DEVICE_TOKEN, null)
        val deviceId = prefs.getString(KEY_DEVICE_ID, null)
        val msisdn = prefs.getString(KEY_ACCOUNT_MSISDN, null)

        if (serverUrl.isNullOrBlank() || token.isNullOrBlank() || deviceId.isNullOrBlank()) {
            return emptyList()
        }

        val migrated = listOf(
            Pairing(
                deviceId = deviceId,
                deviceToken = token,
                serverUrl = serverUrl,
                accountMsisdn = msisdn.orEmpty(),
                provider = "bkash",
                capture = legacyCapture(),
                revoked = prefs.getBoolean(KEY_REVOKED, false),
                // Already approved: it was pairing under the old rules, where
                // scanning was the whole of it. Marking it as waiting would
                // silently stop a phone that has been working for months.
                awaitingApproval = false,
            ),
        )

        write(migrated)
        return migrated
    }

    private fun legacyCapture() = com.jomma.notifier.net.CaptureSettings(
        cashIn = prefs.getBoolean(KEY_CAPTURE_CASH_IN, false),
        outgoing = prefs.getBoolean(KEY_CAPTURE_OUTGOING, false),
        other = prefs.getBoolean(KEY_CAPTURE_OTHER, false),
    )

    /* ── App-wide settings ───────────────────────────────────────────────── */

    var lastHeartbeatAt: Long
        get() = prefs.getLong(KEY_LAST_HEARTBEAT, 0)
        set(value) = prefs.edit().putLong(KEY_LAST_HEARTBEAT, value).apply()

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
        private const val KEY_PAIRINGS = "pairings"

        /** Where a list that would not parse is kept. See `quarantine`. */
        private const val KEY_PAIRINGS_UNREADABLE = "pairings_unreadable"

        // Read once by the migration above, then never again.
        private const val KEY_SERVER_URL = "server_url"
        private const val KEY_DEVICE_TOKEN = "device_token"
        private const val KEY_DEVICE_ID = "device_id"
        private const val KEY_ACCOUNT_MSISDN = "account_msisdn"
        private const val KEY_REVOKED = "revoked"
        private const val KEY_CAPTURE_CASH_IN = "capture_cash_in"
        private const val KEY_CAPTURE_OUTGOING = "capture_outgoing"
        private const val KEY_CAPTURE_OTHER = "capture_other"

        private const val KEY_LAST_HEARTBEAT = "last_heartbeat"
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
