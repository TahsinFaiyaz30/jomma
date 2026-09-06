package com.jomma.notifier.work

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.jomma.notifier.data.CaptureRepository
import java.util.concurrent.TimeUnit

/**
 * Sends the queue.
 *
 * WorkManager owns the retry schedule and survives process death, which is the
 * whole reason flushing is a worker rather than a coroutine inside the capture
 * path. Backoff runs 5s → 15m and never gives up: an unsent capture is money
 * the server does not know about.
 */
class FlushWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result {
        val repository = CaptureRepository(applicationContext)

        return when (val outcome = repository.flush()) {
            is CaptureRepository.FlushOutcome.Sent -> {
                // Anything the server did not acknowledge is still queued.
                if (outcome.stillQueued > 0) Result.retry() else Result.success()
            }

            CaptureRepository.FlushOutcome.Empty -> Result.success()

            // Nothing to do until someone re-provisions. Retrying would just
            // burn battery against a 401.
            CaptureRepository.FlushOutcome.Revoked,
            CaptureRepository.FlushOutcome.NotReady,
            -> Result.success()

            /*
             * Waiting on a person, not on the network. Retrying would hammer a
             * 403 until somebody wandered over to the dashboard; the periodic
             * flush picks these up once approval lands, and nothing is lost
             * because the captures stay queued.
             */
            CaptureRepository.FlushOutcome.AwaitingApproval -> Result.success()

            is CaptureRepository.FlushOutcome.Failed ->
                if (outcome.retryable) Result.retry() else Result.retry()
        }
    }

    companion object {
        const val UNIQUE_NAME = "jomma-flush"
        const val PERIODIC_NAME = "jomma-flush-periodic"

        /** Called the moment a capture lands. */
        fun enqueueNow(context: Context) {
            val request = OneTimeWorkRequestBuilder<FlushWorker>()
                .setConstraints(
                    Constraints.Builder()
                        .setRequiredNetworkType(NetworkType.CONNECTED)
                        .build(),
                )
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 5, TimeUnit.SECONDS)
                .build()

            WorkManager.getInstance(context).enqueueUniqueWork(
                UNIQUE_NAME,
                // Append rather than replace: a flush already in flight is
                // sending an earlier batch, and cancelling it mid-POST would
                // leave those captures queued for no reason. The new run picks
                // up whatever is still pending, including this capture.
                ExistingWorkPolicy.APPEND_OR_REPLACE,
                request,
            )
        }
    }
}
