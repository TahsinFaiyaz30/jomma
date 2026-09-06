package com.jomma.notifier.data

import com.jomma.notifier.data.CaptureRepository.FlushOutcome
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * What a multi-number flush reports back.
 *
 * The aggregate is the whole point and the whole risk. `FlushWorker` decides
 * whether to schedule a retry from `stillQueued` alone, so a number that failed
 * has to be visible in that total — otherwise one number succeeding masks
 * another failing, the worker reads the batch as done, and those captures wait
 * for the next periodic sweep instead of the retry backoff. Minutes rather than
 * seconds, on the one path where a buyer is watching a pay page.
 *
 * The aggregation is reproduced here rather than driven through the repository,
 * which needs Room and a server. What is being pinned is the arithmetic and the
 * decision it feeds, and those are the parts that were wrong.
 */
class FlushOutcomeTest {

    /** Mirrors CaptureRepository.flush's combining step. */
    private fun combine(outcomes: List<FlushOutcome>): FlushOutcome {
        var acknowledged = 0
        var stillQueued = 0
        var failure: FlushOutcome? = null

        for (outcome in outcomes) {
            when (outcome) {
                is FlushOutcome.Sent -> {
                    acknowledged += outcome.acknowledged
                    stillQueued += outcome.stillQueued
                }
                is FlushOutcome.Failed -> {
                    stillQueued += outcome.stillQueued
                    failure = outcome
                }
                FlushOutcome.Empty, FlushOutcome.NotReady -> Unit
                else -> failure = outcome
            }
        }

        if (acknowledged > 0 || stillQueued > 0) return FlushOutcome.Sent(acknowledged, stillQueued)
        return failure ?: FlushOutcome.Empty
    }

    /** What FlushWorker does with the result. */
    private fun retries(outcome: FlushOutcome): Boolean =
        outcome is FlushOutcome.Sent && outcome.stillQueued > 0

    @Test
    fun `one number failing beside one succeeding still asks for a retry`() {
        // The regression. Before this, the failure was dropped on the floor
        // because something else had succeeded.
        val result = combine(
            listOf(
                FlushOutcome.Sent(acknowledged = 3, stillQueued = 0),
                FlushOutcome.Failed("network", retryable = true, stillQueued = 2),
            ),
        )

        assertEquals(FlushOutcome.Sent(3, 2), result)
        assertTrue("the worker must retry while captures are still queued", retries(result))
    }

    @Test
    fun `everything succeeding asks for no retry`() {
        val result = combine(
            listOf(FlushOutcome.Sent(2, 0), FlushOutcome.Sent(1, 0), FlushOutcome.Empty),
        )
        assertEquals(FlushOutcome.Sent(3, 0), result)
        assertTrue("nothing outstanding means nothing to retry", !retries(result))
    }

    @Test
    fun `a revoked number does not stop the others being reported`() {
        val result = combine(listOf(FlushOutcome.Revoked, FlushOutcome.Sent(4, 0)))
        assertEquals(FlushOutcome.Sent(4, 0), result)
    }

    @Test
    fun `waiting for approval alone is not reported as sent`() {
        // Nothing moved, so claiming a send would be a lie -- and it would also
        // stop the caller ever surfacing why.
        assertEquals(FlushOutcome.AwaitingApproval, combine(listOf(FlushOutcome.AwaitingApproval)))
    }

    @Test
    fun `a single failure survives when nothing succeeded`() {
        val result = combine(listOf(FlushOutcome.Failed("offline", retryable = true, stillQueued = 5)))
        assertEquals(FlushOutcome.Sent(0, 5), result)
        assertTrue(retries(result))
    }

    @Test
    fun `nothing queued anywhere is empty rather than sent`() {
        assertEquals(FlushOutcome.Empty, combine(listOf(FlushOutcome.Empty, FlushOutcome.Empty)))
    }
}
