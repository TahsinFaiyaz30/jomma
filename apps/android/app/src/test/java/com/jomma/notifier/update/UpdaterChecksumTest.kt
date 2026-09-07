package com.jomma.notifier.update

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * Reading the checksum file the release publishes.
 *
 * `release.yml` has written a `SHA256SUMS.txt` beside every APK since it was
 * created, and nothing ever read it: a download was written to disk and offered
 * for install on the strength of being more than zero bytes long. A connection
 * that dropped mid-body left a short APK that reached the installer, which
 * refused it with a parse error reading like a corrupt release rather than a
 * bad transfer.
 *
 * Worth saying plainly what this is not. It does not decide whether an APK can
 * be trusted — Android does, by refusing any package whose signing certificate
 * differs from the installed one, and an attacker able to replace the APK on a
 * release would replace the checksum in the same breath. This catches accidents.
 *
 * The parsing is the only part with anything to get wrong, so it is the part
 * that is tested: filenames that are prefixes of each other, the `*` binary-mode
 * marker, and a file that simply does not mention the asset.
 */
class UpdaterChecksumTest {

    private val hashA = "a".repeat(64)
    private val hashB = "b".repeat(64)

    /** What `sha256sum *.apk > SHA256SUMS.txt` actually writes. */
    private val published = """
        $hashA  jomma-notifier-1.4.4-debug.apk
        $hashB  jomma-notifier-1.4.4-release.apk
    """.trimIndent()

    @Test
    fun `finds the hash for the named asset`() {
        assertEquals(hashA, Updater.expectedSha256(published, "jomma-notifier-1.4.4-debug.apk"))
        assertEquals(hashB, Updater.expectedSha256(published, "jomma-notifier-1.4.4-release.apk"))
    }

    @Test
    fun `does not confuse two assets whose names share a prefix`() {
        /*
         * The whole reason this compares the full filename rather than checking
         * for a substring. "…-release.apk" contains "…-rel", and a debug phone
         * offered the release hash would reject a perfectly good download.
         */
        assertNull(Updater.expectedSha256(published, "jomma-notifier-1.4.4-rel"))
        assertNull(Updater.expectedSha256(published, "notifier-1.4.4-debug.apk"))
    }

    @Test
    fun `reads binary-mode output, which marks the name with an asterisk`() {
        // `sha256sum -b`, and most Windows ports by default. A release built on
        // a different runner must not silently stop being checkable.
        val binary = "$hashA *jomma-notifier-1.4.4-debug.apk"
        assertEquals(hashA, Updater.expectedSha256(binary, "jomma-notifier-1.4.4-debug.apk"))
    }

    @Test
    fun `returns null when the asset is not listed at all`() {
        // An older release, or one whose assets were uploaded by hand. The
        // caller installs on the length check alone rather than stranding a
        // phone on an old build.
        assertNull(Updater.expectedSha256(published, "jomma-notifier-9.9.9-release.apk"))
    }

    @Test
    fun `survives blank lines and trailing whitespace`() {
        val messy = "\n  $hashA  jomma-notifier-1.4.4-debug.apk  \n\n"
        assertEquals(hashA, Updater.expectedSha256(messy, "jomma-notifier-1.4.4-debug.apk"))
    }

    @Test
    fun `returns null for an empty or garbage file`() {
        assertNull(Updater.expectedSha256("", "jomma-notifier-1.4.4-debug.apk"))
        assertNull(Updater.expectedSha256("404: Not Found", "jomma-notifier-1.4.4-debug.apk"))
    }
}
