package com.jomma.notifier.ui

import android.app.Application
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import com.jomma.notifier.data.Pairing
import com.jomma.notifier.data.SimCard
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * The rows that only exist once a phone has a pairing.
 *
 * These had never been rendered anywhere, and not for want of trying. They are
 * drawn inside `for (pairing in state.pairings)`, so with no pairing the loop
 * body never executes — and the only way to get a pairing is to scan a code,
 * which `PairingLink.parse` accepts only over https. An emulator therefore
 * cannot pair against a local http dev server, which left "it compiles" as the
 * strongest thing anyone could say about the pause switch and the SIM row.
 *
 * So the whole screen is composed here, not just the card: the loop running at
 * all is half of what is being checked.
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
class NumberCardTest {

    @get:Rule
    val compose = createComposeRule()

    private val account = "8801714205878"

    private fun pairing(
        subscriptionId: Int? = null,
        sendingEnabled: Boolean = true,
        awaitingApproval: Boolean = false,
    ) = Pairing(
        deviceId = "dev-1",
        deviceToken = "jmd_test",
        serverUrl = "https://pay.example.com",
        accountMsisdn = account,
        provider = "bkash",
        subscriptionId = subscriptionId,
        simMsisdn = if (subscriptionId == null) null else account,
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
     * Renders the real screen with a synthetic state and no network of any kind.
     * Returns whatever the pause switch reported, so the wiring is checked and
     * not just the drawing.
     */
    private fun show(state: UiState, onSending: (String, Boolean) -> Unit = { _, _ -> }) {
        compose.setContent {
            JommaTheme(dynamicColor = false) {
                SettingsScreen(
                    state = state,
                    onOpenNotificationSettings = {},
                    onRequestSms = {},
                    onRequestBatteryExemption = {},
                    onOpenAutoStart = {},
                    onScan = {},
                    onCaptureChange = { _, _ -> },
                    onSendingChange = onSending,
                    onRemovePairing = {},
                    onIntervalChange = {},
                    onAutoDownloadChange = {},
                    onUnmeteredOnlyChange = {},
                    onCheckForUpdates = {},
                    onDownloadUpdate = {},
                    onInstallUpdate = {},
                    onDeleteDownload = {},
                    onOpenGitHub = {},
                )
            }
        }
    }

    @Test
    fun `a pairing draws its number and its pause switch`() {
        show(UiState(pairings = listOf(pairing())))

        compose.onNodeWithText(account).performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("Report for this number").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("Messages for it are captured and sent.")
            .performScrollTo()
            .assertIsDisplayed()
    }

    @Test
    fun `pausing reports the device it belongs to, not the phone`() {
        var reported: Pair<String, Boolean>? = null
        show(UiState(pairings = listOf(pairing()))) { id, on -> reported = id to on }

        compose.onNodeWithText("Report for this number").performScrollTo().performClick()

        // Keyed by device id: a phone helping two shops must be able to pause
        // one of them without the other noticing anything.
        assertEquals("dev-1" to false, reported)
    }

    @Test
    fun `a paused number says so, and says nothing is being held`() {
        show(UiState(pairings = listOf(pairing(sendingEnabled = false))))

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
         * in advance whether it will report at all — every other control on the
         * card is disabled until the pairing is live, so this one looks like an
         * oversight to anyone reading quickly.
         */
        var reported: Pair<String, Boolean>? = null
        show(UiState(pairings = listOf(pairing(awaitingApproval = true)))) { id, on ->
            reported = id to on
        }

        compose.onNodeWithText("Scanned. Approve this phone on the dashboard to start capturing.")
            .performScrollTo()
            .assertIsDisplayed()
        compose.onNodeWithText("Report for this number").performScrollTo().assertIsEnabled()

        compose.onNodeWithText("Report for this number").performClick()
        assertEquals("dev-1" to false, reported)
    }

    @Test
    fun `a bound SIM that still agrees just says so`() {
        show(UiState(pairings = listOf(pairing(subscriptionId = 1)), sims = listOf(sim())))

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
        show(
            UiState(
                pairings = listOf(pairing(subscriptionId = 1)),
                sims = listOf(sim(msisdn = "8801911111111")),
            ),
        )

        compose.onNodeWithText(
            "This SIM now reports 8801911111111, not $account. " +
                "Captures are refused until it matches.",
        ).performScrollTo().assertIsDisplayed()
    }

    @Test
    fun `a SIM that will not say its number still names the mismatch`() {
        // The carrier never wrote it and IMS did not answer. The row has to
        // read as a sentence rather than trailing off into an empty string.
        show(
            UiState(
                pairings = listOf(pairing(subscriptionId = 1)),
                sims = listOf(sim(msisdn = null)),
            ),
        )

        compose.onNodeWithText("no number", substring = true).performScrollTo().assertIsDisplayed()
    }

    @Test
    fun `a pairing whose SIM has been pulled shows no SIM row at all`() {
        // Nothing to compare against, so nothing is claimed. Showing a stale
        // carrier name here would be worse than showing none.
        show(UiState(pairings = listOf(pairing(subscriptionId = 1)), sims = emptyList()))

        compose.onNodeWithText(account).performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("SIM 1 · Grameenphone").assertDoesNotExist()
        compose.onNodeWithText("Messages on this SIM belong to this number.").assertDoesNotExist()
    }

    @Test
    fun `two numbers on one phone each get their own switch`() {
        // The reason any of this is a list. Two pairings, two independent
        // switches, and pausing one must report only that one's device id.
        val second = pairing().copy(deviceId = "dev-2", accountMsisdn = "8801812345678")
        val reported = mutableListOf<Pair<String, Boolean>>()
        show(UiState(pairings = listOf(pairing(), second))) { id, on -> reported += id to on }

        compose.onAllNodesWithText("Report for this number")[1].performScrollTo().performClick()

        assertEquals(listOf("dev-2" to false), reported)
    }
}
