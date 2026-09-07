package com.jomma.notifier.ui

import android.app.Application
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import com.jomma.notifier.data.Attribution
import com.jomma.notifier.data.Pairing
import com.jomma.notifier.data.SimCard
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * One wallet's own screen.
 *
 * These rows used to be a card in a "Numbers" list inside Settings, and had
 * never been rendered anywhere before that list was tested: they were drawn
 * inside `for (pairing in state.pairings)`, so with no pairing the loop body
 * never executed — and the only way to get a pairing is to scan a code, which
 * `PairingLink.parse` accepts over https only. An emulator cannot pair against
 * a local http dev server, which left "it compiles" as the strongest thing
 * anyone could say about the pause switch and the SIM row.
 *
 * The list is gone: Settings is for what is true of the *phone*, and a wallet's
 * capture rules are true of the account. So these now render [WalletScreen]
 * directly, which is where they live. That the screen is reachable at all is
 * covered by `MfsSectionTest`, where Manage opens it.
 *
 * Robolectric rather than an instrumented test because CI has no emulator and
 * runs only `testDebugUnitTest` — an `androidTest` would compile, report
 * nothing, and quietly stop meaning anything.
 *
 * A plain `Application` replaces `JommaApp`, whose `onCreate` opens encrypted
 * preferences and can start a foreground service. None of that is under test
 * and all of it is a way for this to fail for unrelated reasons.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = Application::class)
class WalletScreenTest {

    @get:Rule
    val compose = createComposeRule()

    private val account = "8801714205878"

    private fun pairing(
        deviceId: String = "dev-1",
        msisdn: String = account,
        subscriptionId: Int? = null,
        sendingEnabled: Boolean = true,
        awaitingApproval: Boolean = false,
    ) = Pairing(
        deviceId = deviceId,
        deviceToken = "jmd_test",
        serverUrl = "https://pay.example.com",
        accountMsisdn = msisdn,
        provider = "bkash",
        subscriptionId = subscriptionId,
        simMsisdn = if (subscriptionId == null) null else msisdn,
        awaitingApproval = awaitingApproval,
        sendingEnabled = sendingEnabled,
    )

    private fun sim(subscriptionId: Int = 1, msisdn: String? = account) = SimCard(
        subscriptionId = subscriptionId,
        slotIndex = 0,
        carrierName = "Grameenphone",
        displayName = "GP",
        msisdn = msisdn,
        numberSource = "ims",
        networkGeneration = "4G",
    )

    /**
     * Renders the real screen for one wallet, with no network of any kind.
     * `all` is every pairing the phone holds, which is what decides whether a
     * SIM has to be named to tell two same-provider numbers apart.
     */
    private fun show(
        wallet: Pairing,
        all: List<Pairing> = listOf(wallet),
        sims: List<SimCard> = emptyList(),
        onSending: (String, Boolean) -> Unit = { _, _ -> },
        onRemove: () -> Unit = {},
    ) {
        compose.setContent {
            JommaTheme(dynamicColor = false) {
                WalletScreen(
                    pairing = wallet,
                    saving = false,
                    needsSim = Attribution.needsSubscriptionId(all, wallet),
                    sims = sims,
                    onCaptureChange = {},
                    onSendingChange = { on -> onSending(wallet.deviceId, on) },
                    onRemove = onRemove,
                )
            }
        }
    }

    @Test
    fun `a wallet draws its number and its pause switch`() {
        show(pairing())

        compose.onNodeWithText(account).performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("Report for this number").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("Messages for it are captured and sent.")
            .performScrollTo()
            .assertIsDisplayed()
    }

    @Test
    fun `the screen is titled by the wallet it belongs to`() {
        // The whole reason it is a screen and not a tab. Somebody who pressed
        // Manage on bKash should never be in doubt which one they are editing.
        show(pairing())

        compose.onNodeWithText("Bkash").performScrollTo().assertIsDisplayed()
        // And the card below it no longer just repeats the title.
        compose.onNodeWithText("Working. Messages for this number are being captured.")
            .performScrollTo()
            .assertIsDisplayed()
    }

    @Test
    fun `pausing reports the device it belongs to, not the phone`() {
        var reported: Pair<String, Boolean>? = null
        show(pairing(), onSending = { id, on -> reported = id to on })

        compose.onNodeWithText("Report for this number").performScrollTo().performClick()

        // Keyed by device id: a phone helping two shops must be able to pause
        // one of them without the other noticing anything.
        assertEquals("dev-1" to false, reported)
    }

    @Test
    fun `a second wallet's screen reports that wallet, not the first`() {
        // What the old "two cards, two switches" test was really checking, now
        // that one screen shows one wallet: the identity travels with it.
        val second = pairing(deviceId = "dev-2", msisdn = "8801812345678")
        var reported: Pair<String, Boolean>? = null
        show(second, all = listOf(pairing(), second), onSending = { id, on -> reported = id to on })

        compose.onNodeWithText("Report for this number").performScrollTo().performClick()

        assertEquals("dev-2" to false, reported)
    }

    @Test
    fun `a paused wallet says so, and says nothing is being held`() {
        show(pairing(sendingEnabled = false))

        compose.onNodeWithText("Paused on this phone. The dashboard is told.")
            .performScrollTo()
            .assertIsDisplayed()
        // The half people get wrong: off means dropped, not queued for later.
        compose.onNodeWithText("Paused. Nothing is captured, and nothing is held back to send later.")
            .performScrollTo()
            .assertIsDisplayed()
    }

    @Test
    fun `the switch works while approval is still pending`() {
        /*
         * Deliberate, and the kind of thing a tidy-up reverts. Somebody whose
         * phone has been scanned but not yet approved should be able to decide
         * in advance whether it will report at all — every other control here is
         * disabled until the pairing is live, so this one looks like an
         * oversight to anyone reading quickly.
         */
        var reported: Pair<String, Boolean>? = null
        show(pairing(awaitingApproval = true), onSending = { id, on -> reported = id to on })

        compose.onNodeWithText("Scanned. Approve this phone on the dashboard to start capturing.")
            .performScrollTo()
            .assertIsDisplayed()
        compose.onNodeWithText("Report for this number").performScrollTo().assertIsEnabled()

        compose.onNodeWithText("Report for this number").performClick()
        assertEquals("dev-1" to false, reported)
    }

    @Test
    fun `Remove hands back the wallet it was pressed on`() {
        var removed = false
        show(pairing(), onRemove = { removed = true })

        compose.onNodeWithText("Remove").performScrollTo().performClick()
        assertEquals(true, removed)
    }

    @Test
    fun `a bound SIM that still agrees just says so`() {
        show(pairing(subscriptionId = 1), sims = listOf(sim()))

        compose.onNodeWithText("SIM 1 · Grameenphone").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("Messages on this SIM belong to this number.")
            .performScrollTo()
            .assertIsDisplayed()
    }

    @Test
    fun `a swapped SIM names both numbers and says captures are refused`() {
        /*
         * The failsafe made visible. A subscription id is Android's handle for
         * a SIM, not the SIM itself, and handles get reused — put a different
         * SIM in the same slot and messages from a stranger arrive under an id
         * this phone still trusts. `Attribution` already refuses the capture;
         * without this row the only symptom is payments silently not arriving.
         */
        show(pairing(subscriptionId = 1), sims = listOf(sim(msisdn = "8801911111111")))

        compose.onNodeWithText(
            "This SIM now reports 8801911111111, not $account. " +
                "Captures are refused until it matches.",
        ).performScrollTo().assertIsDisplayed()
    }

    @Test
    fun `a SIM that will not say its number still names the mismatch`() {
        // The carrier never wrote it and IMS did not answer. The row has to
        // read as a sentence rather than trailing off into an empty string.
        show(pairing(subscriptionId = 1), sims = listOf(sim(msisdn = null)))

        compose.onNodeWithText(
            "This SIM now reports no number, not $account. Captures are refused until it matches.",
        ).performScrollTo().assertIsDisplayed()
    }

    @Test
    fun `a wallet whose SIM has been pulled shows no SIM row at all`() {
        // Nothing to compare against, so nothing is claimed. Showing a stale
        // carrier name here would be worse than showing none.
        show(pairing(subscriptionId = 1), sims = emptyList())

        compose.onNodeWithText(account).performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("SIM 1 · Grameenphone").assertDoesNotExist()
        compose.onNodeWithText("Messages on this SIM belong to this number.").assertDoesNotExist()
    }
}
