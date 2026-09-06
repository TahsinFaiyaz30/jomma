package com.jomma.notifier.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * Turning whatever a SIM says its number is into the one form the server stores.
 *
 * This is the join between the two halves of the feature: the phone detects a
 * number, the dashboard has an account keyed by one, and they have to be the
 * same string or the SIM binds to nothing. The server's `canonicalMsisdn` is the
 * definition; this is its twin, and the cases below are lifted from that test so
 * the pair cannot drift apart quietly.
 *
 * It is also the gate on `usable`. A SIM whose number will not canonicalise is
 * offered as unselectable rather than as something to type over, so being wrong
 * here means either a SIM nobody can pick or an account bound to a number that
 * does not exist.
 */
class SimInventoryTest {

    @Test
    fun `every way a SIM might write a Bangladeshi number lands on the 880 form`() {
        for (raw in listOf(
            "8801712345678",
            "01712345678",
            "+8801712345678",
            "+880 1712-345678",
            "880 1712 345678",
        )) {
            assertEquals(raw, "8801712345678", SimInventory.canonicalise(raw))
        }
    }

    @Test
    fun `a number from another country is not usable`() {
        // The emulator reports a US test number, and a roaming SIM is a real
        // case. Neither is an account this app can watch, and treating one as
        // usable would bind a pairing to a number no bKash message will name.
        assertNull(SimInventory.canonicalise("+1 555 521 5554"))
        assertNull(SimInventory.canonicalise("15555215554"))
    }

    @Test
    fun `nothing at all is not usable`() {
        // The ordinary failure: the carrier never wrote the number to the SIM,
        // so every source returns empty. That SIM is shown and not selectable.
        for (raw in listOf(null, "", "   ", "unknown")) {
            assertNull(SimInventory.canonicalise(raw))
        }
    }

    @Test
    fun `an operator prefix that does not exist is refused`() {
        // 012 is not allocated. Accepting it would create an account that no
        // message can ever arrive on.
        assertNull(SimInventory.canonicalise("01212345678"))
        assertNull(SimInventory.canonicalise("8801212345678"))
    }

    @Test
    fun `a truncated or overlong number is refused`() {
        assertNull(SimInventory.canonicalise("017123456"))
        assertNull(SimInventory.canonicalise("017123456789"))
    }

    @Test
    fun `every allocated operator prefix is accepted`() {
        // 013 through 019 are live in Bangladesh. Rejecting one would make that
        // operator's SIMs unusable for no reason anybody could work out.
        for (prefix in 3..9) {
            val number = "01${prefix}12345678"
            assertEquals(number, "8801${prefix}12345678", SimInventory.canonicalise(number))
        }
    }

    @Test
    fun `a usable card is the one with a number`() {
        val card = SimCard(
            subscriptionId = 1,
            slotIndex = 0,
            carrierName = "Grameenphone",
            displayName = "GP",
            msisdn = "8801712345678",
            numberSource = "ims",
            networkGeneration = "4G",
        )
        assert(card.usable)
        assert(!card.copy(msisdn = null, numberSource = null).usable)
    }
}
