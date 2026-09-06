package com.jomma.notifier.data

import com.jomma.notifier.net.CaptureSettings
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Which watched number a message belongs to.
 *
 * The consequence of getting this wrong is not a display bug: a capture posted
 * under the wrong pairing is one merchant's payment arriving in another's feed,
 * on a phone that may be watching two unrelated businesses. So most of what is
 * asserted below is that ambiguity produces *nothing* — the cases where the app
 * refuses to guess are the ones worth pinning down, because a missing payment
 * gets chased and a wrong one does not.
 */
class AttributionTest {

    private fun pairing(
        id: String,
        msisdn: String,
        provider: String,
        subscriptionId: Int? = null,
        revoked: Boolean = false,
        awaiting: Boolean = false,
    ) = Pairing(
        deviceId = id,
        deviceToken = "jmd_$id",
        serverUrl = "https://pay.example.com",
        accountMsisdn = msisdn,
        provider = provider,
        capture = CaptureSettings(),
        subscriptionId = subscriptionId,
        revoked = revoked,
        awaitingApproval = awaiting,
    )

    private val bkash = pairing("a", "8801700000001", "bkash")
    private val nagad = pairing("b", "8801800000002", "nagad")

    /* ── Notifications ───────────────────────────────────────────────────── */

    @Test
    fun `a notification goes to the pairing for its provider`() {
        val chosen = Attribution.forNotification(listOf(bkash, nagad), "com.bKash.customerapp")
        assertEquals(bkash.deviceId, chosen?.deviceId)
    }

    @Test
    fun `nagad notifications are told apart from bkash`() {
        val chosen = Attribution.forNotification(listOf(bkash, nagad), "com.konasl.nagad")
        assertEquals(nagad.deviceId, chosen?.deviceId)
    }

    @Test
    fun `an unknown package is refused rather than guessed at`() {
        assertNull(Attribution.forNotification(listOf(bkash, nagad), "com.whatsapp"))
        assertNull(Attribution.forNotification(listOf(bkash, nagad), null))
    }

    @Test
    fun `two pairings for one provider make a notification unattributable`() {
        // A notification cannot say which SIM it relates to, so with two bKash
        // accounts on one phone there is no honest answer. Refusing beats
        // crediting the wrong merchant.
        val second = pairing("c", "8801700000009", "bkash")
        assertNull(Attribution.forNotification(listOf(bkash, second), "com.bKash.customerapp"))
    }

    @Test
    fun `a pairing that cannot report is not a candidate`() {
        val revoked = pairing("a", "8801700000001", "bkash", revoked = true)
        val waiting = pairing("a", "8801700000001", "bkash", awaiting = true)

        assertNull(Attribution.forNotification(listOf(revoked), "com.bKash.customerapp"))
        assertNull(Attribution.forNotification(listOf(waiting), "com.bKash.customerapp"))
    }

    /* ── SMS ─────────────────────────────────────────────────────────────── */

    @Test
    fun `an sms goes by its sender when only one pairing could have it`() {
        val chosen = Attribution.forSms(listOf(bkash, nagad), "bKash", subscriptionId = -1)
        assertEquals(bkash.deviceId, chosen?.deviceId)
    }

    @Test
    fun `sender matching survives the decoration operators add`() {
        // Carriers deliver these as "bKash", "BKASH-BD", "16247-bKash" and worse.
        for (sender in listOf("bKash", "BKASH-BD", "16247-bKash", "bkash ")) {
            assertEquals(
                "sender $sender",
                bkash.deviceId,
                Attribution.forSms(listOf(bkash, nagad), sender, null)?.deviceId,
            )
        }
    }

    @Test
    fun `the sim wins when two pairings share a provider`() {
        val first = pairing("a", "8801700000001", "bkash", subscriptionId = 1)
        val second = pairing("c", "8801700000009", "bkash", subscriptionId = 2)

        assertEquals(
            second.deviceId,
            Attribution.forSms(listOf(first, second), "bKash", subscriptionId = 2)?.deviceId,
        )
    }

    @Test
    fun `two pairings on one provider with no sim recorded are unattributable`() {
        val second = pairing("c", "8801700000009", "bkash")
        assertNull(Attribution.forSms(listOf(bkash, second), "bKash", subscriptionId = -1))
    }

    @Test
    fun `an unknown sender is refused`() {
        assertNull(Attribution.forSms(listOf(bkash, nagad), "DBBL", subscriptionId = -1))
        assertNull(Attribution.forSms(listOf(bkash, nagad), null, subscriptionId = -1))
    }

    /* ── Asking about the SIM ────────────────────────────────────────────── */

    @Test
    fun `the sim is only asked about when it would resolve something`() {
        // One account per provider: the sender already identifies it, so asking
        // would be a question with one possible answer.
        assertFalse(Attribution.needsSubscriptionId(listOf(bkash, nagad), bkash))

        val second = pairing("c", "8801700000009", "bkash")
        assertTrue(Attribution.needsSubscriptionId(listOf(bkash, second), bkash))
    }

    @Test
    fun `once a sim is recorded the question stops being asked`() {
        val first = pairing("a", "8801700000001", "bkash", subscriptionId = 1)
        val second = pairing("c", "8801700000009", "bkash")
        assertFalse(Attribution.needsSubscriptionId(listOf(first, second), first))
    }
}
