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
