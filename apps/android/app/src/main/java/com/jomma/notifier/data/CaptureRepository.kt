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

    private val dao = JommaDatabase.get(context).captureDao()
    private val api = JommaApi(context)
    private val prefs = Prefs.get(context)

    /** Step 1, and the only step that must never fail. */
    suspend fun enqueue(source: String, raw: String, pkg: String? = null): Boolean {
        val trimmed = raw.trim()
        if (trimmed.isEmpty()) return false

        return try {
            dao.insert(Capture(source = source, raw = trimmed, pkg = pkg)) != -1L
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
     * `accepted`, `duplicate`, and `unparsed` all mean the same thing to the
     * device: the server has the raw text and owns it now. Only a transport
     * failure leaves an item queued.
     */
    suspend fun flush(): FlushOutcome {
        if (!prefs.isProvisioned || prefs.revoked) return FlushOutcome.NotReady

        val pending = dao.pending()
        if (pending.isEmpty()) return FlushOutcome.Empty

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
                if (acknowledged.isNotEmpty()) dao.markSent(acknowledged)

                // Anything the server did not mention stays queued and goes
                // again next time rather than being assumed delivered.
                val missed = pending.map { it.localId } - acknowledged.toSet()
                if (missed.isNotEmpty()) {
                    dao.markFailed(missed, "not acknowledged by the server")
                }

                FlushOutcome.Sent(acknowledged.size, missed.size)
            }

            JommaApi.Result.Revoked -> FlushOutcome.Revoked

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
        data class Failed(val message: String, val retryable: Boolean) : FlushOutcome
    }

    companion object {
        private const val TAG = "JommaCapture"
        private const val RETENTION_MS = 30L * 24 * 60 * 60 * 1000
        private val ISO: DateTimeFormatter = DateTimeFormatter.ISO_INSTANT
    }
}
