package com.jomma.notifier.data

import android.content.Context
import android.util.Log
import com.jomma.notifier.net.CaptureBatch
import com.jomma.notifier.net.CaptureItem
import com.jomma.notifier.net.JommaApi
import java.time.Instant
import java.time.format.DateTimeFormatter

/**
 * The capture path.
 *
 * `enqueue` writes to Room and returns. Nothing else. Flushing is a separate
 * step that can fail, retry, and be scheduled — which is exactly why the write
 * comes first and is never conditional on the network.
 */
class CaptureRepository(context: Context) {

    private val appContext = context.applicationContext
    private val dao = JommaDatabase.get(context).captureDao()
    private val prefs = Prefs.get(context)

    /**
     * Step 1, and the only step that must never fail.
     *
     * Takes the pairing rather than working it out, because attribution depends
     * on what arrived — see [Attribution] — and the caller is the only thing
     * still holding it.
     */
    suspend fun enqueue(
        pairing: Pairing,
        source: String,
        raw: String,
        pkg: String? = null,
    ): Boolean {
        val trimmed = raw.trim()
        if (trimmed.isEmpty()) return false

        return try {
            dao.insert(
                Capture(
                    deviceId = pairing.deviceId,
                    source = source,
                    raw = trimmed,
                    pkg = pkg,
                ),
            ) != -1L
        } catch (error: Exception) {
            // Nothing recoverable to do, but never crash the listener — a crash
            // takes the whole capture path down with it.
            Log.e(TAG, "failed to enqueue a capture", error)
            false
        }
    }

    suspend fun pendingCount(): Int = dao.pendingCount()

    /**
     * Steps 2 and 3. Sends the entire pending queue in one request, then marks
     * only what the server acknowledged.
     *
     * `accepted`, `duplicate`, `unparsed` and `filtered` all mean the same thing
     * to the device: the server has answered and there is nothing left to
     * retry. Only a transport failure leaves an item queued.
     *
     * The status is recorded rather than discarded because `filtered` — a
     * message the account's capture settings excluded — is the one case where
     * "delivered" and "stored" differ, and the Log screen has to be able to say
     * so.
     */
    suspend fun flush(): FlushOutcome {
        val live = prefs.livePairings
        if (live.isEmpty()) return FlushOutcome.NotReady

        /*
         * One batch per number, because each goes under its own credential.
         * Combining them would mean choosing a token for a request carrying
         * another number's messages, which is the exact mistake this whole
         * refactor exists to make impossible.
         */
        var acknowledged = 0
        var stillQueued = 0
        var failure: FlushOutcome? = null

        for (pairing in live) {
            when (val outcome = flushOne(pairing)) {
                is FlushOutcome.Sent -> {
                    acknowledged += outcome.acknowledged
                    stillQueued += outcome.stillQueued
                }
                FlushOutcome.Empty, FlushOutcome.NotReady -> Unit
                // Remembered, not returned: one number being revoked or offline
                // must not stop the others from flushing.
                else -> failure = outcome
            }
        }

        if (acknowledged > 0 || stillQueued > 0) return FlushOutcome.Sent(acknowledged, stillQueued)
        return failure ?: FlushOutcome.Empty
    }

    private suspend fun flushOne(pairing: Pairing): FlushOutcome {
        val pending = dao.pendingFor(pairing.deviceId)
        if (pending.isEmpty()) return FlushOutcome.Empty

        val api = JommaApi(appContext, pairing)

        val batch = CaptureBatch(
            captures = pending.map { capture ->
                CaptureItem(
                    localId = capture.localId,
                    source = capture.source,
                    pkg = capture.pkg,
                    raw = capture.raw,
                    capturedAt = ISO.format(Instant.ofEpochMilli(capture.capturedAt)),
                )
            },
        )

        return when (val result = api.sendCaptures(batch)) {
            is JommaApi.Result.Ok -> {
                val acknowledged = result.value.results.map { it.localId }

                for ((outcome, items) in result.value.results.groupBy { it.status }) {
                    dao.markSent(items.map { it.localId }, outcome)
                }

                // Anything the server did not mention stays queued and goes
                // again next time rather than being assumed delivered.
                val missed = pending.map { it.localId } - acknowledged.toSet()
                if (missed.isNotEmpty()) {
                    dao.markFailed(missed, "not acknowledged by the server")
                }

                FlushOutcome.Sent(acknowledged.size, missed.size)
            }

            JommaApi.Result.Revoked -> FlushOutcome.Revoked

            // Nothing is marked failed: the messages are fine and the token is
            // fine, a person simply has not pressed Approve yet. Leaving them
            // untouched means the attempt count does not climb while waiting.
            JommaApi.Result.AwaitingApproval -> FlushOutcome.AwaitingApproval

            is JommaApi.Result.Failed -> {
                dao.markFailed(pending.map { it.localId }, result.message)
                FlushOutcome.Failed(result.message, result.retryable)
            }
        }
    }

    /** Sent captures older than 30 days. Unsent ones are never pruned. */
    suspend fun prune() {
        val cutoff = System.currentTimeMillis() - RETENTION_MS
        dao.pruneSentBefore(cutoff)
    }

    sealed interface FlushOutcome {
        data object NotReady : FlushOutcome
        data object Empty : FlushOutcome
        data class Sent(val acknowledged: Int, val stillQueued: Int) : FlushOutcome
        data object Revoked : FlushOutcome
        data object AwaitingApproval : FlushOutcome
        data class Failed(val message: String, val retryable: Boolean) : FlushOutcome
    }

    companion object {
        private const val TAG = "JommaCapture"
        private const val RETENTION_MS = 30L * 24 * 60 * 60 * 1000
        private val ISO: DateTimeFormatter = DateTimeFormatter.ISO_INSTANT
    }
}
