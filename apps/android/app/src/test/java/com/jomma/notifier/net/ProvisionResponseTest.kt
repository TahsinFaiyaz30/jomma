package com.jomma.notifier.net

import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * Parsing what the server actually sends back when a phone pairs.
 *
 * `account` was declared non-null, from when the only kind of code was one
 * minted for a number that already existed. Pairing to a *business* — which is
 * now the ordinary first step, with the number chosen afterwards from the SIMs
 * the phone reports — answers `"account": null`, and kotlinx.serialization
 * refused the entire body:
 *
 *     Unexpected JSON token at offset 190: Expected start of the object '{',
 *     but had 'n' instead at path: $.account
 *
 * Which names neither the field's purpose nor the reason. Scanning the code the
 * dashboard shows simply failed, on the one screen a new phone starts at.
 *
 * The web integration suite asserts the server returns null here, and the
 * Android suite never parsed a response at all, so both sides were "tested" and
 * the seam between them was not. These fixtures are the bytes off the wire.
 */
class ProvisionResponseTest {

    private val json = Json { ignoreUnknownKeys = true }

    @Test
    fun `parses a business pairing, which carries no account`() {
        val body = """
            {"device_token":"jmd_abc","device_id":"01a0-dead-beef",
             "business":{"id":"01a0-1111","name":"My shop"},
             "account":null,"request_id":"req_0W052X5"}
        """.trimIndent()

        val parsed = json.decodeFromString<ProvisionResponse>(body)

        assertEquals("jmd_abc", parsed.deviceToken)
        assertEquals("01a0-dead-beef", parsed.deviceId)
        assertNull(parsed.account)
    }

    @Test
    fun `parses an account pairing, which carries one`() {
        // What redeeming an `add_account` command returns, and what the older
        // per-number QR always returned.
        val body = """
            {"device_token":"jmd_xyz","device_id":"01a0-cafe",
             "account":{"msisdn":"8801799887766","provider":"bkash"},
             "request_id":"req_1"}
        """.trimIndent()

        val parsed = json.decodeFromString<ProvisionResponse>(body)

        assertEquals("8801799887766", parsed.account?.msisdn)
        assertEquals("bkash", parsed.account?.provider)
    }

    @Test
    fun `parses a body that omits account entirely`() {
        // Defaulted rather than merely nullable, so an older or leaner server
        // that leaves the key out is read the same way as one sending null.
        val body = """{"device_token":"jmd_1","device_id":"01a0-2"}"""

        assertNull(json.decodeFromString<ProvisionResponse>(body).account)
    }

    @Test
    fun `ignores fields this app does not know about`() {
        // The server adds fields without shipping a new APK to every phone in
        // a drawer, so an unknown key must not fail the parse.
        val body = """
            {"device_token":"jmd_1","device_id":"01a0-2","account":null,
             "something_added_later":{"nested":true}}
        """.trimIndent()

        assertEquals("jmd_1", json.decodeFromString<ProvisionResponse>(body).deviceToken)
    }
}
