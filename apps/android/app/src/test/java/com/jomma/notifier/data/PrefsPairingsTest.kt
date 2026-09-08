package com.jomma.notifier.data

import android.content.SharedPreferences
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlin.concurrent.thread
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * How the pairing list survives being written by more than one thread, and what
 * happens when it cannot be read back.
 *
 * Both of these were wrong, and neither shows up in ordinary use — they need a
 * heartbeat landing at the same moment as a scan, or a stored blob that will not
 * parse. What they cost when they do fire is a device token, which the server
 * issues once and never shows again.
 *
 * `SharedPreferences` is an interface, so the fake below is enough and no
 * Robolectric is needed. It buffers edits until `apply`, like the real one, and
 * is itself thread-safe so that what is under test is the lock rather than the
 * fake.
 */
class PrefsPairingsTest {

    private fun pairing(id: String, msisdn: String = "88017$id") = Pairing(
        deviceId = id,
        deviceToken = "tok_$id",
        serverUrl = "https://jomma.test",
        accountMsisdn = msisdn,
        provider = "bkash",
        awaitingApproval = false,
    )

    /* ── Concurrency ─────────────────────────────────────────────────────── */

    @Test
    fun `pairings added from many threads at once all survive`() {
        // The regression. Each mutator reads the whole list, changes it and
        // writes it back; unlocked, two threads that read before either wrote
        // means the slower write is computed from a stale list and the faster
        // one vanishes. HeartbeatWorker, FlushWorker and the UI all write.
        val prefs = Prefs(FakePrefs())
        val count = 32
        val start = CountDownLatch(1)
        val done = CountDownLatch(count)

        repeat(count) { i ->
            thread {
                start.await()
                prefs.upsertPairing(pairing("dev$i"))
                done.countDown()
            }
        }

        start.countDown()
        assertTrue("threads did not finish", done.await(20, TimeUnit.SECONDS))

        assertEquals(count, prefs.pairings.size)
        assertEquals(
            "every pairing should be distinct and present",
            (0 until count).map { "dev$it" }.toSet(),
            prefs.pairings.map { it.deviceId }.toSet(),
        )
    }

    @Test
    fun `a scan landing during a heartbeat sweep is not overwritten`() {
        // The shape that actually costs something: the sweep updates existing
        // pairings while someone scans a new code. The stale-list write used to
        // drop the new pairing, leaving a device the dashboard shows as active
        // and the phone has no record of.
        val prefs = Prefs(FakePrefs())
        prefs.upsertPairing(pairing("existing"))

        val start = CountDownLatch(1)
        val done = CountDownLatch(2)

        thread {
            start.await()
            repeat(200) {
                prefs.updatePairing("existing") { p -> p.copy(lastHeartbeatAt = p.lastHeartbeatAt + 1) }
            }
            done.countDown()
        }
        thread {
            start.await()
            prefs.upsertPairing(pairing("scanned"))
            done.countDown()
        }

        start.countDown()
        assertTrue(done.await(20, TimeUnit.SECONDS))

        assertNotNull("the scanned pairing was lost", prefs.pairing("scanned"))
        assertEquals(200L, prefs.pairing("existing")?.lastHeartbeatAt)
    }

    /* ── An unreadable list ──────────────────────────────────────────────── */

    @Test
    fun `a list that will not parse is kept rather than written over`() {
        // Before this, an unreadable blob read back as "no pairings" and the
        // next write -- a heartbeat, with nobody present -- persisted that
        // emptiness over the real tokens. Unrecoverable: tokens are shown once.
        val backing = FakePrefs()
        backing.seed("pairings", "{ not json at all")
        val prefs = Prefs(backing)

        assertEquals("an unparseable list reads as empty", emptyList<Pairing>(), prefs.pairings)

        prefs.upsertPairing(pairing("fresh"))

        assertEquals(
            "the original must still be on disk",
            "{ not json at all",
            backing.getString("pairings_unreadable", null),
        )
        assertEquals(listOf("fresh"), prefs.pairings.map { it.deviceId })
    }

    @Test
    fun `the quarantined copy is not replaced by a later failure`() {
        val backing = FakePrefs()
        backing.seed("pairings", "first corruption")
        val prefs = Prefs(backing)

        prefs.pairings
        backing.seed("pairings", "second corruption")
        prefs.pairings

        assertEquals(
            "the first copy is the one holding the tokens",
            "first corruption",
            backing.getString("pairings_unreadable", null),
        )
    }

    @Test
    fun `an ordinary list is never quarantined`() {
        val backing = FakePrefs()
        val prefs = Prefs(backing)
        prefs.upsertPairing(pairing("dev1"))

        assertEquals(listOf("dev1"), prefs.pairings.map { it.deviceId })
        assertNull(backing.getString("pairings_unreadable", null))
    }

    /* ── The legacy migration ────────────────────────────────────────────── */

    @Test
    fun `a single-pairing install is carried over still approved`() {
        val backing = FakePrefs()
        backing.seed("server_url", "https://jomma.test")
        backing.seed("device_token", "tok_old")
        backing.seed("device_id", "dev_old")
        backing.seed("account_msisdn", "8801711111111")
        backing.seed("capture_cash_in", true)

        val prefs = Prefs(backing)
        val migrated = prefs.pairings

        assertEquals(1, migrated.size)
        val only = migrated.first()
        assertEquals("dev_old", only.deviceId)
        assertEquals("tok_old", only.deviceToken)
        assertTrue("a phone that has been working must not start waiting", only.live)
        assertTrue("its capture settings come with it", only.capture.cashIn)
        assertNotNull("the migration is persisted, not recomputed", backing.getString("pairings", null))
    }

    @Test
    fun `a half-written legacy install does not become a pairing`() {
        // No token means nothing that can report. Inventing a pairing from it
        // would show a paired number that 401s on every capture.
        val backing = FakePrefs()
        backing.seed("server_url", "https://jomma.test")
        backing.seed("device_id", "dev_old")

        assertEquals(emptyList<Pairing>(), Prefs(backing).pairings)
    }

    /* ── The ordinary operations ─────────────────────────────────────────── */

    @Test
    fun `upsert replaces by device id rather than appending a duplicate`() {
        val prefs = Prefs(FakePrefs())
        prefs.upsertPairing(pairing("dev1"))
        prefs.upsertPairing(pairing("dev1").copy(deviceToken = "rotated"))

        assertEquals(1, prefs.pairings.size)
        assertEquals("rotated", prefs.pairing("dev1")?.deviceToken)
    }

    @Test
    fun `revoking one number leaves the others reporting`() {
        val prefs = Prefs(FakePrefs())
        prefs.upsertPairing(pairing("dev1"))
        prefs.upsertPairing(pairing("dev2"))
        prefs.updatePairing("dev1") { it.copy(revoked = true) }

        assertEquals(listOf("dev2"), prefs.livePairings.map { it.deviceId })
        assertEquals("the revoked one is still on the phone, just not live", 2, prefs.pairings.size)
    }

    @Test
    fun `watches answers by number so a second scan cannot double every capture`() {
        val prefs = Prefs(FakePrefs())
        prefs.upsertPairing(pairing("dev1", msisdn = "8801711111111"))

        assertTrue(prefs.watches("8801711111111"))
        assertTrue(!prefs.watches("8801722222222"))
    }

    @Test
    fun `removing the last pairing leaves the phone unprovisioned`() {
        val prefs = Prefs(FakePrefs())
        prefs.upsertPairing(pairing("dev1"))
        assertTrue(prefs.isProvisioned)

        prefs.removePairing("dev1")
        assertTrue(!prefs.isProvisioned)
    }

    /* ── What the heartbeat is allowed to beat ───────────────────────────── */

    @Test
    fun `a phone waiting for approval still beats, or it can never learn it was approved`() {
        /*
         * The deadlock, and the reason this list exists at all.
         *
         * Approval is answered over the heartbeat: the server refuses one from a
         * device that is still `awaiting_approval` and accepts it the moment
         * somebody says yes, and `HeartbeatWorker.beat` clears the flag on that
         * first success. It is the only thing that clears it.
         *
         * `HeartbeatWorker.doWork` swept `livePairings`, which excludes exactly
         * these — so a phone that had scanned sent nothing, learned nothing, and
         * sat on "Approve this phone on the dashboard" while the dashboard said
         * it was connected. Neither screen was lying and no button on either
         * could break the tie.
         */
        val prefs = Prefs(FakePrefs())
        prefs.upsertPairing(pairing("scanned").copy(awaitingApproval = true))

        assertEquals("nothing is live yet", emptyList<String>(), prefs.livePairings.map { it.deviceId })
        assertEquals(
            "but it must still be beaten",
            listOf("scanned"),
            prefs.beatingPairings.map { it.deviceId },
        )
    }

    @Test
    fun `a revoked pairing is not beaten`() {
        // The other edge. Its credential no longer verifies, so beating it just
        // spends battery on a 401 -- and unlike waiting for approval, nothing
        // about the answer can ever change.
        val prefs = Prefs(FakePrefs())
        prefs.upsertPairing(pairing("dev1"))
        prefs.upsertPairing(pairing("dev2").copy(revoked = true))

        assertEquals(listOf("dev1"), prefs.beatingPairings.map { it.deviceId })
    }

    @Test
    fun `settingUp covers both halves of getting a phone going`() {
        // Approval, then choosing the SIM. Both are resolved by beating and both
        // leave somebody watching two screens disagree, so both poll faster.
        val prefs = Prefs(FakePrefs())

        prefs.upsertPairing(pairing("scanned").copy(awaitingApproval = true))
        assertTrue("waiting for approval", prefs.settingUp)

        // Approved, and now waiting for a number to be chosen for it.
        prefs.updatePairing("scanned") { it.copy(awaitingApproval = false, accountMsisdn = null) }
        assertTrue("approved, no number yet", prefs.settingUp)

        prefs.updatePairing("scanned") { it.copy(accountMsisdn = "8801711111111") }
        assertTrue("done — stop polling", !prefs.settingUp)
    }

    @Test
    fun `the business pairing keeps no number of its own, and that is not setup`() {
        /*
         * The one that would have polled forever.
         *
         * Choosing a SIM does not replace the account-less business pairing; it
         * adds a second one beside it. That first pairing never gets a number —
         * it is the credential the phone beats and reports its SIMs with — so
         * "any pairing without a number" is true for the entire life of the
         * install, and a four-second poll would have run behind every screen
         * for as long as the app was open.
         */
        val prefs = Prefs(FakePrefs())
        prefs.upsertPairing(pairing("business").copy(accountMsisdn = null, provider = null))
        assertTrue("nothing chosen yet, so still setting up", prefs.settingUp)

        prefs.upsertPairing(pairing("bkash", msisdn = "8801711111111"))
        assertTrue(
            "a wallet exists — the account-less one must not keep it polling",
            !prefs.settingUp,
        )
    }

    @Test
    fun `a phone with nothing paired is not setting up`() {
        // Nothing to poll for. The fast loop exists for somebody watching a
        // handset finish, not for a fresh install sitting on the setup card.
        assertTrue(!Prefs(FakePrefs()).settingUp)
    }

    /* ── Businesses ──────────────────────────────────────────────────────── */

    private fun forBusiness(id: String, business: String, msisdn: String?) = Pairing(
        deviceId = id,
        deviceToken = "tok_$id",
        serverUrl = "https://jomma.test",
        businessId = business,
        businessName = "Shop $business",
        accountMsisdn = msisdn,
        provider = if (msisdn == null) null else "bkash",
        awaitingApproval = false,
    )

    @Test
    fun `pairings gather into the merchants they belong to`() {
        // The unit every screen works in. A phone pairs to a business and then
        // supplies it with what only a handset has; the numbers are the
        // business's, so "which shop" has to be answerable before anything else.
        val prefs = Prefs(FakePrefs())
        prefs.upsertPairing(forBusiness("d1", "b1", null))
        prefs.upsertPairing(forBusiness("d2", "b1", "8801711111111"))
        prefs.upsertPairing(forBusiness("d3", "b2", "8801722222222"))

        val businesses = prefs.businesses
        assertEquals(2, businesses.size)
        assertEquals(listOf("Shop b1", "Shop b2"), businesses.map { it.name })
        // The account-less pairing is the credential the phone beats with. It
        // belongs to the business but is not one of its wallets.
        assertEquals(2, businesses.first().pairings.size)
        assertEquals(listOf("8801711111111"), businesses.first().wallets.map { it.accountMsisdn })
    }

    @Test
    fun `a pairing from before the business was stored stands on its own`() {
        /*
         * Upgrades. Such a pairing has no business id, and collapsing them all
         * into one group would offer to disable several unrelated merchants
         * with a single switch. Each stands alone until a heartbeat names it.
         */
        val prefs = Prefs(FakePrefs())
        prefs.upsertPairing(pairing("legacy1"))
        prefs.upsertPairing(pairing("legacy2"))

        assertEquals(2, prefs.businesses.size)
    }

    @Test
    fun `disabling a merchant stops all of its numbers and none of anyone else's`() {
        // Per business, because that is the decision somebody actually makes: a
        // shop closes for the season. Doing it a number at a time left a
        // business half-off whenever one was missed.
        val prefs = Prefs(FakePrefs())
        prefs.upsertPairing(forBusiness("d1", "b1", null))
        prefs.upsertPairing(forBusiness("d2", "b1", "8801711111111"))
        prefs.upsertPairing(forBusiness("d3", "b2", "8801722222222"))

        prefs.setBusinessEnabled("b1", false)

        assertTrue("nothing is sent for it", !prefs.business("b1")!!.enabled)
        assertTrue("the other is untouched", prefs.business("b2")!!.enabled)
        /*
         * And it is not an unpairing. The credentials survive, so the phone
         * keeps beating for it and every beat carries the flag — which is how
         * the dashboard shows "the phone has paused this" rather than a handset
         * that has silently gone quiet. That difference is the whole reason
         * this is a switch and not a Remove.
         */
        assertEquals(2, prefs.business("b1")!!.pairings.size)
        assertTrue(prefs.business("b1")!!.pairings.none { it.revoked })
        assertEquals("and it still beats", 3, prefs.beatingPairings.size)
    }

    @Test
    fun `re-enabling a merchant turns every one of its numbers back on`() {
        val prefs = Prefs(FakePrefs())
        prefs.upsertPairing(forBusiness("d1", "b1", "8801711111111"))
        prefs.upsertPairing(forBusiness("d2", "b1", "8801733333333"))

        prefs.setBusinessEnabled("b1", false)
        prefs.setBusinessEnabled("b1", true)

        assertTrue(prefs.business("b1")!!.pairings.all { it.sendingEnabled })
    }

    /* ── What may actually be sent ───────────────────────────────────────── */

    @Test
    fun `a paused merchant is not something to send for`() {
        /*
         * The leak. Pausing set the flag and stopped *new* messages being
         * captured, and the flush went on sweeping `livePairings` — which says
         * only that the credential works. So a business somebody had switched
         * off kept receiving whatever was already queued, and a test capture
         * went to it too, while the switch promised neither would happen.
         *
         * Three lists with three meanings, and only one of them answers "what
         * may be uploaded".
         */
        val prefs = Prefs(FakePrefs())
        prefs.upsertPairing(forBusiness("d1", "b1", "8801711111111"))
        prefs.upsertPairing(forBusiness("d2", "b2", "8801722222222"))

        prefs.setBusinessEnabled("b1", false)

        assertEquals(
            "only the merchant that is still on",
            listOf("d2"),
            prefs.capturingPairings.map { it.deviceId },
        )
        // Still live and still beating. The credential works and the dashboard
        // is told it is paused, which is the entire point of pausing rather
        // than disconnecting.
        assertEquals(2, prefs.livePairings.size)
        assertEquals(2, prefs.beatingPairings.size)
    }

    @Test
    fun `a pairing with no number is never something to send for`() {
        // The account-less business pairing beats and reports SIMs. It has no
        // account to file a capture against, so the endpoint refuses it — and
        // the test-capture button used to pick exactly this one.
        val prefs = Prefs(FakePrefs())
        prefs.upsertPairing(forBusiness("d1", "b1", null))

        assertEquals(emptyList<String>(), prefs.capturingPairings.map { it.deviceId })
        assertEquals("but it is live, and it beats", 1, prefs.livePairings.size)
    }

    @Test
    fun `resuming a merchant makes it sendable again`() {
        val prefs = Prefs(FakePrefs())
        prefs.upsertPairing(forBusiness("d1", "b1", "8801711111111"))

        prefs.setBusinessEnabled("b1", false)
        assertTrue(prefs.capturingPairings.isEmpty())

        prefs.setBusinessEnabled("b1", true)
        assertEquals(listOf("d1"), prefs.capturingPairings.map { it.deviceId })
    }
}

/** A thread-safe in-memory stand-in that buffers edits until `apply`, as the real one does. */
private class FakePrefs : SharedPreferences {
    private val values = ConcurrentHashMap<String, Any>()

    fun seed(key: String, value: Any) {
        values[key] = value
    }

    override fun getAll(): MutableMap<String, *> = values.toMutableMap()
    override fun getString(key: String, defValue: String?): String? = values[key] as? String ?: defValue
    override fun getBoolean(key: String, defValue: Boolean): Boolean = values[key] as? Boolean ?: defValue
    override fun getLong(key: String, defValue: Long): Long = values[key] as? Long ?: defValue
    override fun getInt(key: String, defValue: Int): Int = values[key] as? Int ?: defValue
    override fun getFloat(key: String, defValue: Float): Float = values[key] as? Float ?: defValue
    override fun contains(key: String): Boolean = values.containsKey(key)

    override fun getStringSet(key: String, defValues: MutableSet<String>?): MutableSet<String>? =
        @Suppress("UNCHECKED_CAST")
        (values[key] as? MutableSet<String>) ?: defValues

    override fun edit(): SharedPreferences.Editor = FakeEditor()

    override fun registerOnSharedPreferenceChangeListener(
        listener: SharedPreferences.OnSharedPreferenceChangeListener?,
    ) = Unit

    override fun unregisterOnSharedPreferenceChangeListener(
        listener: SharedPreferences.OnSharedPreferenceChangeListener?,
    ) = Unit

    private inner class FakeEditor : SharedPreferences.Editor {
        private val pending = LinkedHashMap<String, Any?>()
        private var clearing = false

        private fun set(key: String, value: Any?): SharedPreferences.Editor {
            pending[key] = value
            return this
        }

        override fun putString(key: String, value: String?) = set(key, value)
        override fun putBoolean(key: String, value: Boolean) = set(key, value)
        override fun putLong(key: String, value: Long) = set(key, value)
        override fun putInt(key: String, value: Int) = set(key, value)
        override fun putFloat(key: String, value: Float) = set(key, value)
        override fun putStringSet(key: String, values: MutableSet<String>?) = set(key, values)
        override fun remove(key: String) = set(key, null)

        override fun clear(): SharedPreferences.Editor {
            clearing = true
            return this
        }

        override fun commit(): Boolean {
            if (clearing) values.clear()
            for ((key, value) in pending) {
                if (value == null) values.remove(key) else values[key] = value
            }
            pending.clear()
            clearing = false
            return true
        }

        override fun apply() {
            commit()
        }
    }
}
