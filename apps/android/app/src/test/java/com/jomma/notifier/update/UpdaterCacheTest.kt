package com.jomma.notifier.update

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * What happens to a downloaded APK, and when.
 *
 * Two rules meet in `isSpent` and they pull in opposite directions. A build that
 * has installed must be thrown away — it is twelve megabytes on a phone chosen
 * for being cheap. A build that has *not* installed yet must be kept, and this
 * runs on every launch, so getting that half wrong would delete the update
 * somebody is about to install and make them pay for the download twice.
 *
 * Both directions are pinned here for that reason: a rule that deleted
 * everything would satisfy the first on its own.
 */
class UpdaterCacheTest {

    /* ── After an install ────────────────────────────────────────────────── */

    @Test
    fun `the version now running is dropped, which is how an installed APK is cleaned up`() {
        // The install replaces the process, so nothing in the old one can run a
        // callback. Comparing what is on disk against what is now running is the
        // answer after the fact -- and it is still right if the install was
        // abandoned halfway or the phone rebooted during it.
        assertTrue(Updater.isSpent("jomma-1.4.2-release.apk", "1.4.2"))
        assertTrue(Updater.isSpent("jomma-1.4.2-debug.apk", "1.4.2"))
    }

    @Test
    fun `an older build is dropped`() {
        assertTrue(Updater.isSpent("jomma-1.3.0-release.apk", "1.4.2"))
        assertTrue(Updater.isSpent("jomma-1.4.1-release.apk", "1.4.2"))
    }

    /* ── Before one ──────────────────────────────────────────────────────── */

    @Test
    fun `a newer build is kept, because it is the one about to be installed`() {
        assertFalse(Updater.isSpent("jomma-1.5.0-release.apk", "1.4.2"))
        assertFalse(Updater.isSpent("jomma-1.4.3-debug.apk", "1.4.2"))
    }

    @Test
    fun `ten beats nine, so a download does not vanish at 1_10_0`() {
        // String comparison would rank 1.10.0 below 1.9.0 and delete it.
        assertFalse(Updater.isSpent("jomma-1.10.0-release.apk", "1.9.0"))
        assertTrue(Updater.isSpent("jomma-1.9.0-release.apk", "1.10.0"))
    }

    /* ── Anything else ───────────────────────────────────────────────────── */

    @Test
    fun `a file this code did not write is dropped`() {
        // Nothing else writes to that directory, so an unrecognisable name is a
        // leftover from a build that named things differently.
        for (name in listOf("whatever.apk", "jomma-.apk", "jomma-release.apk", "notes.txt")) {
            assertTrue(name, Updater.isSpent(name, "1.4.2"))
        }
    }

    @Test
    fun `a pre-release shares its version's fate`() {
        // 1.5.0-rc1 and 1.5.0 are the same release for this purpose, per
        // compareVersions -- so an rc downloaded before the final still counts
        // as newer than what is running and is kept.
        assertFalse(Updater.isSpent("jomma-1.5.0-rc1-release.apk", "1.4.2"))
    }

    /* ── The comparison underneath ───────────────────────────────────────── */

    @Test
    fun `compareVersions orders numerically, segment by segment`() {
        assertTrue(Updater.compareVersions("1.10.0", "1.9.0") > 0)
        assertTrue(Updater.compareVersions("1.4.2", "1.4.10") < 0)
        assertEquals(0, Updater.compareVersions("1.4.2", "1.4.2"))
        assertEquals(0, Updater.compareVersions("1.4.2-rc1", "1.4.2"))
    }

    @Test
    fun `a version with fewer segments is not thereby larger`() {
        assertTrue(Updater.compareVersions("1.4", "1.4.1") < 0)
        assertEquals(0, Updater.compareVersions("1.4", "1.4.0"))
    }
}
