package com.jomma.notifier.update

import android.content.Context
import android.app.PendingIntent
import android.content.Intent
import android.content.pm.PackageInstaller
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.util.Log
import com.jomma.notifier.BuildConfig
import com.jomma.notifier.data.Prefs
import java.io.File
import java.io.IOException
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject

/**
 * Keeping the app up to date without a store.
 *
 * This is sideloaded software on a phone that sits in a drawer, so nothing
 * updates it unless it updates itself. A fix like the scanner crash in 1.1.1
 * otherwise reaches nobody: the person who needs it is the one least likely to
 * be watching a releases page.
 *
 * Releases come from the project's own GitHub, and the *matching variant* is
 * downloaded — release build gets the release APK, debug gets the debug APK.
 * That is not tidiness. Android refuses an update signed by a different key,
 * and the two are signed differently, so offering the wrong one fails at the
 * very last step with a message nobody can act on.
 *
 * Nothing here installs silently. Android requires the user to allow this app
 * to install packages, and then confirms the install itself. Both prompts are
 * the point rather than an obstacle.
 */
object Updater {

    private const val TAG = "JommaUpdate"
    private const val SESSION_NAME = "jomma-update"
    private const val RELEASES_URL =
        "https://api.github.com/repos/TahsinFaiyaz30/jomma/releases/latest"

    /** Where the downloaded APK lives. Cache, so Android can reclaim it. */
    private fun downloadDir(context: Context) = File(context.cacheDir, "updates").apply { mkdirs() }

    private val client: OkHttpClient by lazy {
        OkHttpClient.Builder()
            .connectTimeout(20, TimeUnit.SECONDS)
            // An APK over a slow connection is a long read, and timing out
            // halfway wastes the data already spent.
            .readTimeout(5, TimeUnit.MINUTES)
            .build()
    }

    /** The variant this build is, and therefore the asset it must be offered. */
    val variant: String get() = if (BuildConfig.DEBUG) "debug" else "release"

    sealed interface CheckResult {
        data class UpToDate(val version: String) : CheckResult
        data class Available(val update: AvailableUpdate) : CheckResult
        data class Failed(val message: String) : CheckResult
    }

    /**
     * Asks GitHub what the latest release is.
     *
     * Unauthenticated, which is rate limited to 60 requests an hour per IP —
     * far beyond anything these intervals can reach, and it keeps a token off
     * the device.
     */
    suspend fun check(context: Context): CheckResult = withContext(Dispatchers.IO) {
        val current = BuildConfig.VERSION_NAME
        try {
            val request = Request.Builder()
                .url(RELEASES_URL)
                .header("Accept", "application/vnd.github+json")
                .build()

            client.newCall(request).execute().use { response ->
                if (!response.isSuccessful) {
                    return@withContext CheckResult.Failed("GitHub said ${response.code}")
                }

                val body = response.body?.string().orEmpty()
                val json = JSONObject(body)
                val tag = json.optString("tag_name")
                val latest = tag.removePrefix("v")

                if (latest.isBlank()) {
                    return@withContext CheckResult.Failed("No version in the latest release")
                }
                if (compareVersions(latest, current) <= 0) {
                    return@withContext CheckResult.UpToDate(current)
                }

                val assets = json.optJSONArray("assets")
                var url: String? = null
                var size = 0L
                var name = ""

                // Matched on the variant suffix rather than position: the two
                // APKs and the checksum file are in no guaranteed order.
                for (i in 0 until (assets?.length() ?: 0)) {
                    val asset = assets!!.getJSONObject(i)
                    val assetName = asset.optString("name")
                    if (assetName.endsWith("-$variant.apk")) {
                        url = asset.optString("browser_download_url")
                        size = asset.optLong("size")
                        name = assetName
                        break
                    }
                }

                if (url.isNullOrBlank()) {
                    return@withContext CheckResult.Failed(
                        "Release $tag has no $variant APK",
                    )
                }

                Log.i(TAG, "update available: $current -> $latest ($name)")
                CheckResult.Available(
                    AvailableUpdate(
                        version = latest,
                        tag = tag,
                        downloadUrl = url,
                        sizeBytes = size,
                        notes = json.optString("body").take(500),
                        variant = variant,
                    ),
                )
            }
        } catch (error: IOException) {
            CheckResult.Failed(error.message ?: "Network error")
        } catch (error: Exception) {
            CheckResult.Failed(error.message ?: "Could not read the release")
        }
    }

    /**
     * Downloads the APK, replacing anything downloaded before.
     *
     * Old files are cleared first rather than accumulating: each is twelve
     * megabytes, and a build that was never installed has no reason to be kept.
     */
    suspend fun download(
        context: Context,
        update: AvailableUpdate,
        onProgress: (Int) -> Unit = {},
    ): File? = withContext(Dispatchers.IO) {
        val dir = downloadDir(context)
        dir.listFiles()?.forEach { it.delete() }

        val target = File(dir, "jomma-${update.version}-${update.variant}.apk")

        try {
            val request = Request.Builder().url(update.downloadUrl).build()
            client.newCall(request).execute().use { response ->
                if (!response.isSuccessful) {
                    Log.w(TAG, "download failed: ${response.code}")
                    return@withContext null
                }
                val body = response.body ?: return@withContext null
                val total = body.contentLength()

                body.byteStream().use { input ->
                    target.outputStream().use { output ->
                        val buffer = ByteArray(64 * 1024)
                        var written = 0L
                        while (true) {
                            val read = input.read(buffer)
                            if (read < 0) break
                            output.write(buffer, 0, read)
                            written += read
                            if (total > 0) onProgress(((written * 100) / total).toInt())
                        }
                    }
                }
            }
            target
        } catch (error: Exception) {
            Log.w(TAG, "download failed", error)
            // A partial APK is worse than none: the installer would reject it
            // with a parse error that reads like a corrupt release.
            target.delete()
            null
        }
    }

    /** An already-downloaded APK for this version, if there is one. */
    fun downloadedFile(context: Context, update: AvailableUpdate): File? =
        File(downloadDir(context), "jomma-${update.version}-${update.variant}.apk")
            .takeIf { it.isFile && it.length() > 0 }

    /** Removes anything left in the update cache. */
    fun clearDownloads(context: Context) {
        downloadDir(context).listFiles()?.forEach { it.delete() }
    }

    /**
     * Drops a cached APK that the running build has caught up with.
     *
     * Called on launch rather than after the installer returns, because there
     * is nothing to return to — a successful install replaces this process, so
     * no callback in the old one ever runs. Comparing what is on disk against
     * what is now running answers the question after the fact and, unlike a
     * "delete when the install finishes" hook, is still correct when the
     * install was abandoned halfway or the phone was rebooted during it.
     *
     * Files that are not ours, or whose name carries no readable version, go
     * too. Nothing else writes to this directory, so anything unrecognisable
     * is a leftover from a build that named things differently.
     */
    fun purgeInstalledDownloads(context: Context) {
        val current = BuildConfig.VERSION_NAME
        downloadDir(context).listFiles()?.forEach { file ->
            val version = file.name
                .takeIf { it.startsWith("jomma-") && it.endsWith(".apk") }
                ?.removePrefix("jomma-")
                ?.substringBefore('-')

            if (version.isNullOrBlank() || compareVersions(version, current) <= 0) {
                file.delete()
            }
        }
    }

    /** Whether Android will let this app start an install at all. */
    fun canInstall(context: Context): Boolean =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            context.packageManager.canRequestPackageInstalls()
        } else {
            true
        }

    /**
     * The settings screen where "install unknown apps" is granted.
     *
     * Per-app since Android 8, so this deep-links to this app's own entry
     * rather than a list to hunt through.
     */
    fun installPermissionIntent(context: Context): Intent =
        Intent(
            Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
            Uri.parse("package:${context.packageName}"),
        ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)

    /**
     * Hands the APK to Android's installer.
     *
     * Through `PackageInstaller` rather than the `ACTION_VIEW` handoff this
     * used to do. That path is the one every tutorial shows and it does not
     * work for an update: on a current Android it goes from `InstallStart`
     * straight to `InstallFailed` without ever showing the confirmation, and
     * the only thing the user sees is "App not installed as package conflicts
     * with an existing package" — for an APK that `pm install` accepts without
     * complaint, signed with the same key, one version code higher. Verified
     * that way round before this was rewritten, so the blame landed on the
     * mechanism rather than on the build.
     *
     * The session API is the supported one, and it is better on its own terms:
     * the bytes are written into a session instead of exposed through a
     * `FileProvider`, so there is no content URI to grant and no provider to
     * declare, and committing produces a real status — see [InstallReceiver].
     *
     * Nothing here bypasses a prompt. The commit comes back asking for user
     * confirmation, which is exactly what it should do.
     *
     * @return an error to show, or null when the session is on its way.
     */
    suspend fun install(context: Context, apk: File): String? = withContext(Dispatchers.IO) {
        val installer = context.packageManager.packageInstaller
        var sessionId = -1

        try {
            val params = PackageInstaller.SessionParams(
                PackageInstaller.SessionParams.MODE_FULL_INSTALL,
            ).apply {
                // Named so Android can check this is an update to us and not an
                // attempt to install something else under our confirmation.
                setAppPackageName(context.packageName)
            }

            sessionId = installer.createSession(params)
            installer.openSession(sessionId).use { session ->
                session.openWrite(SESSION_NAME, 0, apk.length()).use { output ->
                    apk.inputStream().use { input -> input.copyTo(output) }
                    // Without this the bytes can still be in a buffer at commit
                    // and the session is rejected as incomplete.
                    session.fsync(output)
                }

                session.commit(
                    PendingIntent.getBroadcast(
                        context,
                        sessionId,
                        Intent(context, InstallReceiver::class.java)
                            .setPackage(context.packageName),
                        PendingIntent.FLAG_MUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
                    ).intentSender,
                )
            }
            null
        } catch (error: IOException) {
            Log.w(TAG, "install session failed", error)
            if (sessionId != -1) runCatching { installer.abandonSession(sessionId) }
            "Could not stage the update: ${error.message ?: "I/O error"}"
        } catch (error: Exception) {
            Log.w(TAG, "install session failed", error)
            if (sessionId != -1) runCatching { installer.abandonSession(sessionId) }
            "Could not start the install: ${error.message ?: "unknown error"}"
        }
    }

    /**
     * Whether the current connection is one the user agreed to spend.
     *
     * Checking costs a few hundred bytes and always runs; this gates the twelve
     * megabyte download only.
     */
    fun canDownloadNow(context: Context): Boolean {
        val prefs = Prefs.get(context)
        if (!prefs.updatesOnUnmeteredOnly) return true

        val manager = context.getSystemService(ConnectivityManager::class.java) ?: return false
        val capabilities = manager.getNetworkCapabilities(manager.activeNetwork) ?: return false
        return capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED)
    }

    /**
     * Semver comparison, numeric segment by segment.
     *
     * String comparison would rank "1.10.0" below "1.9.0" and quietly stop
     * offering updates at exactly the point a project has shipped ten minor
     * versions. Pre-release suffixes are dropped: `1.2.0-rc1` and `1.2.0` are
     * the same release for this purpose.
     */
    fun compareVersions(a: String, b: String): Int {
        val left = a.substringBefore('-').split('.').map { it.trim().toIntOrNull() ?: 0 }
        val right = b.substringBefore('-').split('.').map { it.trim().toIntOrNull() ?: 0 }
        for (i in 0 until maxOf(left.size, right.size)) {
            val l = left.getOrElse(i) { 0 }
            val r = right.getOrElse(i) { 0 }
            if (l != r) return l.compareTo(r)
        }
        return 0
    }

    /** Whether enough time has passed for the configured interval. */
    fun isCheckDue(context: Context): Boolean {
        val prefs = Prefs.get(context)
        val interval = UpdateInterval.from(prefs.updateInterval)
        if (interval == UpdateInterval.Never) return false
        if (interval == UpdateInterval.EveryLaunch) return true
        return System.currentTimeMillis() - prefs.lastUpdateCheckAt >= interval.millis
    }
}
