package com.jomma.notifier.update

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.util.Log
import androidx.core.content.IntentCompat
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow

/**
 * Where an install session reports back.
 *
 * `PackageInstaller` is asynchronous: committing a session does not install
 * anything, it asks Android to, and Android answers here. Two of the three
 * answers matter.
 *
 * `STATUS_PENDING_USER_ACTION` is the normal one and is not an error — it is
 * Android saying "ask them". The confirmation dialog arrives as an Intent to
 * start, and starting it is the whole reason this receiver exists.
 *
 * A failure arrives with a reason, which is the real gain over the old
 * `ACTION_VIEW` handoff. That path could only ever end in a system dialog
 * reading "App not installed as package conflicts with an existing package",
 * with no way for the app to know it had happened, let alone say anything
 * more useful about it.
 */
class InstallReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        val status = intent.getIntExtra(
            PackageInstaller.EXTRA_STATUS,
            PackageInstaller.STATUS_FAILURE,
        )

        when (status) {
            PackageInstaller.STATUS_PENDING_USER_ACTION -> {
                val confirm = IntentCompat.getParcelableExtra(
                    intent,
                    Intent.EXTRA_INTENT,
                    Intent::class.java,
                )
                if (confirm == null) {
                    report("Android did not return an install prompt")
                    return
                }
                // NEW_TASK because this is a receiver, which has no task of its
                // own to put the dialog in.
                confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                runCatching { context.startActivity(confirm) }
                    .onFailure {
                        Log.w(TAG, "could not show the install prompt", it)
                        report("Could not open the installer")
                    }
            }

            PackageInstaller.STATUS_SUCCESS -> {
                /*
                 * Rarely seen, and that is expected rather than a bug: a
                 * successful install replaces this app, so the process holding
                 * this receiver is usually gone before the broadcast lands. The
                 * cleanup that matters runs on the next launch instead, where
                 * the version now running is the evidence. This is the tidy
                 * path for when it does arrive.
                 */
                Updater.clearDownloads(context)
                report("Installed")
            }

            else -> report(reasonFor(status, intent))
        }
    }

    /**
     * A failure someone can act on.
     *
     * Android's own message is appended when it sends one, but it is written
     * for developers and is often empty, so each status carries a sentence of
     * its own first.
     */
    private fun reasonFor(status: Int, intent: Intent): String {
        val detail = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE)

        val reason = when (status) {
            PackageInstaller.STATUS_FAILURE_ABORTED -> return "Install cancelled"
            PackageInstaller.STATUS_FAILURE_BLOCKED -> "Android blocked the install"
            PackageInstaller.STATUS_FAILURE_CONFLICT ->
                "Conflicts with the copy already installed. Uninstall it first."
            PackageInstaller.STATUS_FAILURE_INCOMPATIBLE -> "This build does not fit this phone"
            PackageInstaller.STATUS_FAILURE_INVALID -> "The download is not a valid APK"
            PackageInstaller.STATUS_FAILURE_STORAGE -> "Not enough free storage to install"
            else -> "Install failed"
        }

        Log.w(TAG, "install failed: status=$status detail=$detail")
        return if (detail.isNullOrBlank()) reason else "$reason · $detail"
    }

    private fun report(message: String) {
        outcomes.tryEmit(message)
    }

    companion object {
        private const val TAG = "JommaUpdate"

        /**
         * Install outcomes, for whatever is on screen to show.
         *
         * A hot flow with a buffer rather than a callback, because the receiver
         * and the screen have no reference to each other and the receiver can
         * fire while nothing is listening. Replay is zero on purpose: an
         * outcome is news, and a stale one redrawn after a rotation would read
         * as a second install having failed.
         */
        val outcomes = MutableSharedFlow<String>(
            replay = 0,
            extraBufferCapacity = 4,
        )

        val messages: SharedFlow<String> get() = outcomes
    }
}
