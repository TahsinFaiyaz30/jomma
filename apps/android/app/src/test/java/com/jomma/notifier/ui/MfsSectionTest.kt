package com.jomma.notifier.ui

import android.app.Application
import androidx.compose.material3.SnackbarHostState
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.v2.createComposeRule
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

    private fun pairing(provider: String? = "bkash", msisdn: String? = account) = Pairing(
        deviceId = "dev-1",
        deviceToken = "jmd_test",
        serverUrl = "https://pay.example.com",
        accountMsisdn = msisdn,
        provider = provider,
        awaitingApproval = false,
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
        onAdd: (String) -> Unit = {},
        onPick: (Int) -> Unit = {},
        onCancel: () -> Unit = {},
        onDestination: (Int) -> Unit = {},
        managing: String? = null,
        onManage: (String) -> Unit = {},
        onCloseManage: () -> Unit = {},
    ) {
        compose.setContent {
            JommaTheme(dynamicColor = false) {
                JommaScreens(
                    state = state,
                    captures = emptyList(),
                    snackbarHost = SnackbarHostState(),
                    destination = 0,
                    onDestinationChange = onDestination,
                    managingDeviceId = managing,
                    onManage = onManage,
                    onCloseManage = onCloseManage,
                    onScan = {},
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
        show(UiState(pairings = listOf(pairing(provider = null, msisdn = null))))

        compose.onNodeWithText("Wallets").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("None yet. Add one below and pick the SIM it is paid on.")
            .performScrollTo()
            .assertIsDisplayed()
    }

    @Test
    fun `a wallet shows its provider, its number, and a way to manage it`() {
        show(UiState(pairings = listOf(pairing())))

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
    fun `Add bKash names the provider, and Nagad is refused rather than hidden`() {
        var asked: String? = null
        show(UiState(pairings = listOf(pairing())), onAdd = { asked = it })

        // Offered and disabled: Nagad accounts can be created, but the parser is
        // a deliberate stub, so nothing would ever be matched from one.
        compose.onNodeWithText("Nagad — soon").performScrollTo().assertIsNotEnabled()

        compose.onNodeWithText("Add bKash").performScrollTo().performClick()
        assertEquals("bkash", asked)
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
        )

        compose.onNodeWithText("Cancel").performScrollTo().performClick()
        assertTrue(cancelled)
    }
}
