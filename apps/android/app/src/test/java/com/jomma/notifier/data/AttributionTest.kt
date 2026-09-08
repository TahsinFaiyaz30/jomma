package com.jomma.notifier.data

import com.jomma.notifier.net.CaptureSettings
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
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

    /** Device ids, in order, so each assertion reads as "who got it". */
    private fun ids(found: List<Pairing>) = found.map { it.deviceId }

    private fun pairing(
        id: String,
        msisdn: String,
        provider: String,
        businessId: String? = null,
        subscriptionId: Int? = null,
        simMsisdn: String? = null,
        revoked: Boolean = false,
        awaiting: Boolean = false,
    ) = Pairing(
        deviceId = id,
        deviceToken = "jmd_$id",
        serverUrl = "https://pay.example.com",
        businessId = businessId,
        accountMsisdn = msisdn,
        simMsisdn = simMsisdn,
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
        assertEquals(listOf(bkash.deviceId), ids(chosen))
    }

    @Test
    fun `nagad notifications are told apart from bkash`() {
        val chosen = Attribution.forNotification(listOf(bkash, nagad), "com.konasl.nagad")
        assertEquals(listOf(nagad.deviceId), ids(chosen))
    }

    @Test
    fun `an unknown package is refused rather than guessed at`() {
        assertEquals(emptyList<String>(), ids(Attribution.forNotification(listOf(bkash, nagad), "com.whatsapp")))
        assertEquals(emptyList<String>(), ids(Attribution.forNotification(listOf(bkash, nagad), null)))
    }

    @Test
    fun `two pairings for one provider make a notification unattributable`() {
        // A notification cannot say which SIM it relates to, so with two bKash
        // accounts on one phone there is no honest answer. Refusing beats
        // crediting the wrong merchant.
        val second = pairing("c", "8801700000009", "bkash")
        assertEquals(emptyList<String>(), ids(Attribution.forNotification(listOf(bkash, second), "com.bKash.customerapp")))
    }

    @Test
    fun `a pairing that cannot report is not a candidate`() {
        val revoked = pairing("a", "8801700000001", "bkash", revoked = true)
        val waiting = pairing("a", "8801700000001", "bkash", awaiting = true)

        assertEquals(emptyList<String>(), ids(Attribution.forNotification(listOf(revoked), "com.bKash.customerapp")))
        assertEquals(emptyList<String>(), ids(Attribution.forNotification(listOf(waiting), "com.bKash.customerapp")))
    }

    /* ── SMS ─────────────────────────────────────────────────────────────── */

    @Test
    fun `an sms goes by its sender when only one pairing could have it`() {
        val chosen = Attribution.forSms(listOf(bkash, nagad), "bKash", subscriptionId = -1)
        assertEquals(listOf(bkash.deviceId), ids(chosen))
    }

    @Test
    fun `sender matching survives the decoration operators add`() {
        // Carriers deliver these as "bKash", "BKASH-BD", "16247-bKash" and worse.
        for (sender in listOf("bKash", "BKASH-BD", "16247-bKash", "bkash ")) {
            assertEquals("sender $sender", listOf(bkash.deviceId), ids(Attribution.forSms(listOf(bkash, nagad), sender, null)))
        }
    }

    @Test
    fun `the sim wins when two pairings share a provider`() {
        val first = pairing("a", "8801700000001", "bkash", subscriptionId = 1)
        val second = pairing("c", "8801700000009", "bkash", subscriptionId = 2)

        assertEquals(listOf(second.deviceId), ids(Attribution.forSms(listOf(first, second), "bKash", subscriptionId = 2)))
    }

    @Test
    fun `two pairings on one provider with no sim recorded are unattributable`() {
        val second = pairing("c", "8801700000009", "bkash")
        assertEquals(emptyList<String>(), ids(Attribution.forSms(listOf(bkash, second), "bKash", subscriptionId = -1)))
    }

    @Test
    fun `an unknown sender is refused`() {
        assertEquals(emptyList<String>(), ids(Attribution.forSms(listOf(bkash, nagad), "DBBL", subscriptionId = -1)))
        assertEquals(emptyList<String>(), ids(Attribution.forSms(listOf(bkash, nagad), null, subscriptionId = -1)))
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

    /* ── The SIM swap failsafe ───────────────────────────────────────────── */

    private fun sim(subscriptionId: Int, msisdn: String?) = SimCard(
        subscriptionId = subscriptionId,
        slotIndex = subscriptionId - 1,
        carrierName = "Grameenphone",
        displayName = "GP",
        msisdn = msisdn,
        numberSource = if (msisdn == null) null else "ims",
        networkGeneration = "4G",
    )

    @Test
    fun `a bound sim still holding its own number is attributed`() {
        val bkash = pairing("a", "8801700000001", "bkash", subscriptionId = 1, simMsisdn = "8801700000001")
        val found = Attribution.forSms(
            listOf(bkash),
            "bKash",
            subscriptionId = 1,
            sims = listOf(sim(1, "8801700000001")),
        )
        assertEquals(listOf("a"), ids(found))
    }

    @Test
    fun `a swapped sim is refused rather than routed to the old account`() {
        /*
         * The whole point of recording the number. Android hands the same
         * subscription id to whatever SIM is in the slot, so without this the
         * messages of whoever owns the new SIM would be captured and posted
         * under the previous account's credential — a stranger's money landing
         * in a merchant's feed, with nothing anywhere saying it had happened.
         */
        val bkash = pairing("a", "8801700000001", "bkash", subscriptionId = 1, simMsisdn = "8801700000001")
        val found = Attribution.forSms(
            listOf(bkash),
            "bKash",
            subscriptionId = 1,
            sims = listOf(sim(1, "8801799999999")),
        )
        assertEquals(emptyList<String>(), ids(found))
    }

    @Test
    fun `two accounts on two sims each get their own messages`() {
        // The case the whole feature exists for: one phone, two bKash accounts,
        // told apart by the SIM the message arrived on.
        val first = pairing("a", "8801700000001", "bkash", subscriptionId = 1, simMsisdn = "8801700000001")
        val second = pairing("b", "8801700000002", "bkash", subscriptionId = 2, simMsisdn = "8801700000002")
        val sims = listOf(sim(1, "8801700000001"), sim(2, "8801700000002"))

        assertEquals(listOf("a"), ids(Attribution.forSms(listOf(first, second), "bKash", 1, sims)))
        assertEquals(listOf("b"), ids(Attribution.forSms(listOf(first, second), "bKash", 2, sims)))
    }

    @Test
    fun `a sim that will not report its number is let through`() {
        // Unreadable is not the same as wrong. Plenty of carriers never write
        // the number to the SIM, and refusing on that would stop a phone that
        // has been working for months the moment it is upgraded.
        val bkash = pairing("a", "8801700000001", "bkash", subscriptionId = 1, simMsisdn = "8801700000001")
        val found = Attribution.forSms(listOf(bkash), "bKash", 1, listOf(sim(1, null)))
        assertEquals(listOf("a"), ids(found))
    }

    @Test
    fun `a pairing from before sim binding keeps working`() {
        // No recorded number means nothing to compare, so nothing to refuse.
        val legacy = pairing("a", "8801700000001", "bkash", subscriptionId = 1)
        val found = Attribution.forSms(listOf(legacy), "bKash", 1, listOf(sim(1, "8801799999999")))
        assertEquals(listOf("a"), ids(found))
    }

    @Test
    fun `an unreadable inventory does not break an existing setup`() {
        // Empty means "could not look" -- the permission has not been granted
        // yet -- which must not read as "the SIM is wrong".
        val bkash = pairing("a", "8801700000001", "bkash", subscriptionId = 1, simMsisdn = "8801700000001")
        assertEquals(listOf("a"), ids(Attribution.forSms(listOf(bkash), "bKash", 1, emptyList())))
    }

    /* ── One number, several businesses ──────────────────────────────────── */

    @Test
    fun `a number watched for two businesses reports to both`() {
        /*
         * The arrangement this exists for: a shop and its online storefront are
         * two businesses on the dashboard, paid on one bKash number, helped by
         * one handset. Two pairings, same number, different merchants.
         *
         * The old code asked for `singleOrNull`, so this did not pick a winner —
         * it dropped the message for *both*, silently, which is the failure this
         * path is least able to notice. Nothing on either dashboard, no error
         * anywhere, and a payment that simply never arrived.
         */
        val shop = pairing("a", "8801700000001", "bkash", businessId = "b1")
        val online = pairing("b", "8801700000001", "bkash", businessId = "b2")

        assertEquals(
            listOf("a", "b"),
            ids(Attribution.forNotification(listOf(shop, online), "com.bKash.customerapp")),
        )
        assertEquals(
            listOf("a", "b"),
            ids(Attribution.forSms(listOf(shop, online), "bKash", subscriptionId = -1)),
        )
    }

    @Test
    fun `sharing a sim reports to every business on it`() {
        // Same, over the SMS path, where the subscription is what matched.
        val shop = pairing("a", "8801700000001", "bkash", businessId = "b1", subscriptionId = 1)
        val online = pairing("b", "8801700000001", "bkash", businessId = "b2", subscriptionId = 1)

        assertEquals(
            listOf("a", "b"),
            ids(Attribution.forSms(listOf(shop, online), "bKash", 1, listOf(sim(1, "8801700000001")))),
        )
    }

    @Test
    fun `two different numbers are still refused rather than fanned out`() {
        // The half that must not move. Fanning out is only ever right when the
        // candidates are the *same* number; two bKash accounts on one phone are
        // still unattributable from a notification, and sending to both would
        // put one merchant's payment in the other's feed — the exact thing this
        // file exists to prevent.
        val first = pairing("a", "8801700000001", "bkash", businessId = "b1")
        val second = pairing("b", "8801700000009", "bkash", businessId = "b2")

        assertEquals(
            emptyList<String>(),
            ids(Attribution.forNotification(listOf(first, second), "com.bKash.customerapp")),
        )
    }

    @Test
    fun `a business that has been paused gets nothing, and the others still do`() {
        // Pausing is per business and must not take the sharers down with it.
        val shop = pairing("a", "8801700000001", "bkash", businessId = "b1")
        val paused = pairing("b", "8801700000001", "bkash", businessId = "b2")
            .copy(sendingEnabled = false)

        assertEquals(
            listOf("a"),
            ids(Attribution.forNotification(listOf(shop, paused), "com.bKash.customerapp")),
        )
    }

    @Test
    fun `sharing a number is not a reason to ask which sim it is on`() {
        // The question only makes sense when two *numbers* need telling apart.
        // Counting pairings asked which SIM a number was on in order to
        // distinguish it from itself.
        val shop = pairing("a", "8801700000001", "bkash", businessId = "b1")
        val online = pairing("b", "8801700000001", "bkash", businessId = "b2")

        assertFalse(Attribution.needsSubscriptionId(listOf(shop, online), shop))
    }
}
