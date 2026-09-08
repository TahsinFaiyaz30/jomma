package com.jomma.notifier.ui

import android.app.Application
import androidx.compose.material3.SnackbarHostState
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import com.jomma.notifier.data.Pairing
import com.jomma.notifier.net.AddableSim
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * Managing wallets from the phone.
 *
 * The whole section sits behind `if (!state.provisioned) … return@Column`, so a
 * phone that has not been connected never reaches it — and a phone that has can
 * only be produced by scanning a code, which `PairingLink.parse` accepts over
 * https only. There is no way to reach this on an emulator pointed at a local
 * dev server, which is the same wall the per-number rows hit.
 *
 * So the real `JommaScreens` is rendered with a synthetic state. Twenty-eight
 * parameters of noise buys the one thing a narrower test could not: proof that
 * the section is actually *reached*, rather than merely that it compiles.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = Application::class)
class MfsSectionTest {

    @get:Rule
    val compose = createComposeRule()

    private val account = "8801714205878"

    private fun pairing(
        provider: String? = "bkash",
        msisdn: String? = account,
        deviceId: String = "dev-1",
        businessId: String = "b1",
        businessName: String = "Karim Store",
        enabled: Boolean = true,
    ) = Pairing(
        deviceId = deviceId,
        deviceToken = "jmd_test",
        serverUrl = "https://pay.example.com",
        businessId = businessId,
        businessName = businessName,
        accountMsisdn = msisdn,
        provider = provider,
        awaitingApproval = false,
        sendingEnabled = enabled,
    )

    private fun sim(id: Int = 1, msisdn: String? = account, blocked: String? = null) = AddableSim(
        subscriptionId = id,
        slotIndex = 0,
        carrierName = "Grameenphone",
        msisdn = msisdn,
        blockedReason = blocked,
    )

    private fun show(
        state: UiState,
        onAdd: (String, String) -> Unit = { _, _ -> },
        onPick: (Int) -> Unit = {},
        onCancel: () -> Unit = {},
        onDestination: (Int) -> Unit = {},
        managing: String? = null,
        managingBusiness: String? = null,
        onManageBusiness: (String) -> Unit = {},
        onManage: (String) -> Unit = {},
        onCloseManage: () -> Unit = {},
        onSwitchBusiness: (String) -> Unit = {},
        onScan: () -> Unit = {},
        onBusinessEnabledChange: (String, Boolean) -> Unit = { _, _ -> },
        onDisconnectBusiness: (String) -> Unit = {},
    ) {
        compose.setContent {
            JommaTheme(dynamicColor = false) {
                JommaScreens(
                    state = state,
                    captures = emptyList(),
                    snackbarHost = SnackbarHostState(),
                    destination = 0,
                    onDestinationChange = onDestination,
                    managingBusinessKey = managingBusiness,
                    onManageBusiness = onManageBusiness,
                    onCloseBusiness = {},
                    managingDeviceId = managing,
                    onManage = onManage,
                    onCloseManage = onCloseManage,
                    onSwitchBusiness = onSwitchBusiness,
                    onBusinessEnabledChange = onBusinessEnabledChange,
                    onDisconnectBusiness = onDisconnectBusiness,
                    onDisconnectEverything = {},
                    onScan = onScan,
                    onAddAccount = onAdd,
                    onPickSim = onPick,
                    onCancelAdd = onCancel,
                    onOpenNotificationSettings = {},
                    onRequestSms = {},
                    onRequestPhone = {},
                    onRequestBatteryExemption = {},
                    onOpenAutoStart = {},
                    onIntervalChange = {},
                    onAutoDownloadChange = {},
                    onUnmeteredOnlyChange = {},
                    onCheckForUpdates = {},
                    onDownloadUpdate = {},
                    onInstallUpdate = {},
                    onDeleteDownload = {},
                    onOpenGitHub = {},
                    onFlush = {},
                    onHeartbeat = {},
                    onTestCapture = {},
                    onCaptureChange = { _, _ -> },
                    onSendingChange = { _, _ -> },
                    onRemovePairing = {},
                )
            }
        }
    }

    @Test
    fun `an unconnected phone is not offered wallets`() {
        // The early return. Adding a wallet needs a credential to add it with,
        // so the setup card is the only thing this screen should show.
        show(UiState())

        compose.onNodeWithText("Set this device up").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("Add bKash").assertDoesNotExist()
    }

    @Test
    fun `a connected phone with no wallet says so and offers to add one`() {
        show(UiState(pairings = listOf(pairing(provider = null, msisdn = null))), managingBusiness = "b1")

        compose.onNodeWithText("Wallets").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("None yet. Add one below and pick the SIM it is paid on.")
            .performScrollTo()
            .assertIsDisplayed()
    }

    @Test
    fun `a wallet shows its provider, its number, and a way to manage it`() {
        show(UiState(pairings = listOf(pairing())), managingBusiness = "b1")

        compose.onNodeWithText("Bkash").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText(account).performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("Manage").performScrollTo().assertIsDisplayed()
    }

    @Test
    fun `Manage opens that wallet's own screen, naming which wallet`() {
        /*
         * It used to switch to the Settings tab, where a "Numbers" list held a
         * card per wallet. Two problems in one gesture: Settings is for what is
         * true of the phone, and the list shadowed this one — the same account
         * in two places with different detail and nothing saying which to
         * believe. Now Manage names a wallet and opens only that.
         */
        var asked: String? = null
        var destination = -1
        show(
            UiState(pairings = listOf(pairing())),
            onDestination = { destination = it },
            onManage = { asked = it },
        
            managingBusiness = "b1"
        )

        compose.onNodeWithText("Manage").performScrollTo().performClick()

        assertEquals("dev-1", asked)
        assertEquals("and does not change tab underneath it", -1, destination)
    }

    @Test
    fun `an open wallet shows its own settings instead of the wallet list`() {
        show(UiState(pairings = listOf(pairing())), managing = "dev-1")

        // Its own rules, on their own screen.
        compose.onNodeWithText("Cash In").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("Report for this number").performScrollTo().assertIsDisplayed()
        // And not the list it was opened from.
        compose.onNodeWithText("Add bKash").assertDoesNotExist()
    }

    @Test
    fun `a wallet removed while its screen is open does not linger`() {
        // The id is held, not the pairing, so state is the single source of
        // truth — otherwise this screen would go on editing something gone.
        show(UiState(pairings = emptyList()), managing = "dev-1")

        compose.onNodeWithText("Cash In").assertDoesNotExist()
        compose.onNodeWithText("Set this device up").performScrollTo().assertIsDisplayed()
    }

    @Test
    fun `Add bKash names the provider and the merchant it is being added to`() {
        var asked: Pair<String, String>? = null
        show(
            UiState(pairings = listOf(pairing())),
            onAdd = { key, provider -> asked = key to provider },
            managingBusiness = "b1",
        )

        // Offered and disabled: Nagad accounts can be created, but the parser is
        // a deliberate stub, so nothing would ever be matched from one.
        compose.onNodeWithText("Nagad — soon").performScrollTo().assertIsNotEnabled()

        compose.onNodeWithText("Add bKash").performScrollTo().performClick()

        /*
         * The merchant travels with it, and is the one whose page this is —
         * never whichever happens to be showing on the status screen. A business
         * can be opened from Settings without becoming the active one, and the
         * request creates a receiving account under that business's credential,
         * so reading the active one would file the number on the wrong shop with
         * nothing later able to notice.
         */
        assertEquals("b1" to "bkash", asked)
    }

    @Test
    fun `choosing a provider lists the SIMs, with unusable ones explained`() {
        show(
            UiState(
                pairings = listOf(pairing()),
                addingProvider = "bkash",
                addableSims = listOf(
                    sim(id = 1),
                    sim(id = 2, msisdn = "8801911111111", blocked = "Already set up for bkash."),
                ),
            ),
        
            managingBusiness = "b1"
        )

        compose.onNodeWithText("Which SIM is your bkash on?").performScrollTo().assertIsDisplayed()
        // Shown with the reason rather than omitted: somebody comparing this
        // against the tray in their hand needs to know why one is missing.
        compose.onNodeWithText("Already set up for bkash.").performScrollTo().assertIsDisplayed()
    }

    @Test
    fun `only a usable SIM can be chosen, and it reports its subscription`() {
        var picked: Int? = null
        show(
            UiState(
                pairings = listOf(pairing()),
                addingProvider = "bkash",
                addableSims = listOf(sim(id = 7)),
            ),
            onPick = { picked = it },
        
            managingBusiness = "b1"
        )

        compose.onNodeWithText("Use").performScrollTo().assertIsEnabled().performClick()

        // A subscription, never a number — the server re-reads the msisdn from
        // what this phone reported, so it cannot claim one it cannot see.
        assertEquals(7, picked)
    }

    @Test
    fun `a SIM with no number cannot be chosen`() {
        show(
            UiState(
                pairings = listOf(pairing()),
                addingProvider = "bkash",
                addableSims = listOf(
                    sim(id = 3, msisdn = null, blocked = "This SIM does not report its own number."),
                ),
            ),
        
            managingBusiness = "b1"
        )

        compose.onNodeWithText("Use").performScrollTo().assertIsNotEnabled()
    }

    @Test
    fun `the picker can be backed out of`() {
        var cancelled = false
        show(
            UiState(
                pairings = listOf(pairing()),
                addingProvider = "bkash",
                addableSims = listOf(sim()),
            ),
            onCancel = { cancelled = true },
        
            managingBusiness = "b1"
        )

        compose.onNodeWithText("Cancel").performScrollTo().performClick()
        assertTrue(cancelled)
    }

    /* ── More than one merchant ──────────────────────────────────────────── */

    @Test
    fun `one business is not made to answer which business`() {
        // The card is always there — it carries the pause switch and the way to
        // leave, which a single-business phone needs as much as any other. Only
        // *switching* is a question it does not have.
        show(UiState(pairings = listOf(pairing())))

        compose.onNodeWithText("Showing").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("The only business this phone helps")
            .performScrollTo()
            .assertIsDisplayed()
        compose.onNodeWithText("Switch").assertDoesNotExist()
    }

    @Test
    fun `the card carries the pause switch and the way to leave`() {
        var toggled: Pair<String, Boolean>? = null
        show(
            UiState(pairings = listOf(pairing())),
            onBusinessEnabledChange = { key, on -> toggled = key to on },
        
            managingBusiness = "b1"
        )

        compose.onNodeWithText("Report for this business").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("Disconnect this business").performScrollTo().assertIsDisplayed()

        compose.onNodeWithContentDescription("Reporting for Karim Store")
            .performScrollTo()
            .performClick()
        assertEquals("b1" to false, toggled)
    }

    @Test
    fun `leaving a business is confirmed, and says how it differs from pausing`() {
        /*
         * The two are a keystroke apart and not at all alike: pausing keeps the
         * credential and keeps beating, so the dashboard reads "paused";
         * disconnecting hands it back and the dashboard reads revoked. Picking
         * the wrong one leaves a phone somebody has to walk to and pair again.
         */
        var disconnected: String? = null
        show(UiState(pairings = listOf(pairing())), onDisconnectBusiness = { disconnected = it }, managingBusiness = "b1")

        compose.onNodeWithText("Disconnect this business").performScrollTo().performClick()
        compose.onNodeWithText("Disconnect from Karim Store?").assertIsDisplayed()
        assertEquals("nothing happens until it is confirmed", null, disconnected)

        compose.onNodeWithText("Disconnect").performClick()
        assertEquals("b1", disconnected)
    }

    @Test
    fun `two businesses get a switcher naming the one on screen`() {
        val karim = pairing(deviceId = "d1", businessId = "b1", businessName = "Karim Store")
        val dhaka = pairing(
            deviceId = "d2",
            businessId = "b2",
            businessName = "Dhaka Electronics",
            msisdn = "8801911223344",
        )
        show(UiState(pairings = listOf(karim, dhaka), activeBusinessKey = "b2"))

        compose.onNodeWithText("Showing").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("Dhaka Electronics").performScrollTo().assertIsDisplayed()
        // Said out loud, because the whole risk of a switcher is somebody
        // reading it as "only this one is running".
        compose.onNodeWithText("1 other also being watched").performScrollTo().assertIsDisplayed()
    }

    @Test
    fun `the wallet list shows only the merchant on screen`() {
        /*
         * Before this the list was every number the phone held, from every
         * shop, in one undifferentiated column — with each Manage button
         * leading somewhere the row did not say it would.
         */
        val karim = pairing(deviceId = "d1", businessId = "b1", businessName = "Karim Store")
        val dhaka = pairing(
            deviceId = "d2",
            businessId = "b2",
            businessName = "Dhaka Electronics",
            msisdn = "8801911223344",
        )
        show(UiState(pairings = listOf(karim, dhaka), activeBusinessKey = "b1"), managingBusiness = "b1")

        compose.onNodeWithText(account).performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("8801911223344").assertDoesNotExist()
    }

    @Test
    fun `switching reports the business, and changes nothing else`() {
        var switched: String? = null
        val karim = pairing(deviceId = "d1", businessId = "b1", businessName = "Karim Store")
        val dhaka = pairing(
            deviceId = "d2",
            businessId = "b2",
            businessName = "Dhaka Electronics",
            msisdn = "8801911223344",
        )
        show(
            UiState(pairings = listOf(karim, dhaka), activeBusinessKey = "b1"),
            onSwitchBusiness = { switched = it },
        )

        compose.onNodeWithText("Switch").performScrollTo().performClick()
        compose.onNodeWithText("Dhaka Electronics").performClick()

        assertEquals("b2", switched)
    }

    @Test
    fun `a paused business is still listed, and says so`() {
        // Hiding one you switched off is how you forget you switched it off —
        // and it is still paired, still beating, still costing the merchant a
        // dashboard that says nothing is arriving.
        val karim = pairing(deviceId = "d1", businessId = "b1", businessName = "Karim Store")
        val paused = pairing(
            deviceId = "d2",
            businessId = "b2",
            businessName = "Chittagong Outlet",
            msisdn = "8801911223344",
            enabled = false,
        )
        show(UiState(pairings = listOf(karim, paused), activeBusinessKey = "b2"))

        compose.onNodeWithText("Paused — nothing is captured for this one")
            .performScrollTo()
            .assertIsDisplayed()
    }

    /* ── What the server thinks of this phone ────────────────────────────── */

    private fun waiting(revoked: Boolean = false) = pairing().copy(
        awaitingApproval = !revoked,
        revoked = revoked,
    )

    @Test
    fun `a phone still waiting says so, and says where to approve it`() {
        /*
         * The screen somebody checks when nothing is arriving. It used to say
         * only that reporting was on — true, useless, and the reason somebody
         * would sit watching a dashboard that never filled.
         *
         * "Approve it on the dashboard" is no help to anybody who has not seen
         * one, so the route is spelled out.
         */
        show(UiState(pairings = listOf(waiting())), managingBusiness = "b1")

        compose.onNodeWithText("Waiting for approval").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText(
            "This phone has scanned Karim Store's code and will capture nothing until " +
                "somebody approves it. On their Jomma dashboard: Accounts, then Devices, " +
                "then Approve.",
        ).performScrollTo().assertIsDisplayed()
    }

    @Test
    fun `a phone that was turned away says declined, not merely waiting`() {
        /*
         * They look identical from the phone and want opposite reactions: one is
         * wait, the other is ask again with a new code. Showing "waiting" for a
         * declined phone means somebody waits for a decision already made.
         */
        show(UiState(pairings = listOf(waiting(revoked = true))), managingBusiness = "b1")

        compose.onNodeWithText("Declined").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("Waiting for approval").assertDoesNotExist()
    }

    @Test
    fun `either way there is a way back, and it scans a fresh code`() {
        // A pairing code is used once and expires, so "try again" always means a
        // new one — and after a decline it is the only route back at all.
        var scanned = false
        show(
            UiState(pairings = listOf(waiting(revoked = true))),
            onScan = { scanned = true },
            managingBusiness = "b1",
        )

        compose.onNodeWithText("Scan a new code").performScrollTo().performClick()
        assertTrue(scanned)
    }

    @Test
    fun `a working business is not told about approval at all`() {
        // The card is for a phone that is stuck. On one that is not, it would be
        // three lines of reassurance nobody asked for, above the thing they came
        // to change.
        show(UiState(pairings = listOf(pairing())), managingBusiness = "b1")

        compose.onNodeWithText("Waiting for approval").assertDoesNotExist()
        compose.onNodeWithText("Declined").assertDoesNotExist()
        compose.onNodeWithText("Scan a new code").assertDoesNotExist()
    }
}
