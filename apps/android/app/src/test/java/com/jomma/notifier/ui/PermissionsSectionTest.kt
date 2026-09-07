package com.jomma.notifier.ui

import android.app.Application
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import com.jomma.notifier.data.Pairing
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * Every permission the app needs has a way to grant it.
 *
 * The phone permission did not. `READ_PHONE_STATE` and `READ_PHONE_NUMBERS`
 * were declared in the manifest and checked by `SimInventory`, and no screen
 * anywhere asked for them — the permissions card offered notification access
 * and SMS and stopped. Choosing which number a phone watches is done by picking
 * one of its SIMs, so the whole feature was unreachable unless somebody knew to
 * grant it by hand in Android's app info, which nothing told them to do. The
 * SIM card said "Phone permission not granted" and was not even clickable: it
 * named the problem and left you there.
 *
 * Nothing caught it because nothing looked. The permission was wired end to end
 * on the reading side — the heartbeat carries SIMs, the dashboard renders them,
 * both are tested — and the one missing piece was the request that makes any of
 * it happen.
 *
 * So these assert the *route*, not the plumbing: for each permission the state
 * models, the screen shows a row and tapping it calls back.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = Application::class)
class PermissionsSectionTest {

    @get:Rule
    val compose = createComposeRule()

    private fun show(
        state: UiState,
        onSms: () -> Unit = {},
        onPhone: () -> Unit = {},
        onNotifications: () -> Unit = {},
        onBattery: () -> Unit = {},
        onRemovePairing: (String) -> Unit = {},
    ) {
        compose.setContent {
            JommaTheme(dynamicColor = false) {
                SettingsScreen(
                    state = state,
                    onOpenNotificationSettings = onNotifications,
                    onRequestSms = onSms,
                    onRequestPhone = onPhone,
                    onRequestBatteryExemption = onBattery,
                    onOpenAutoStart = {},
                    onScan = {},
                    onCaptureChange = { _, _ -> },
                    onSendingChange = { _, _ -> },
                    onRemovePairing = onRemovePairing,
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
    fun `the phone permission has a row of its own`() {
        show(UiState(hasPhoneStatePermission = false))

        compose.onNodeWithText("Phone permission").performScrollTo().assertIsDisplayed()
    }

    @Test
    fun `tapping it asks for the permission`() {
        // The whole bug in one assertion. The row can exist and still be inert.
        var asked = false
        show(UiState(hasPhoneStatePermission = false), onPhone = { asked = true })

        compose.onNodeWithText("Phone permission").performScrollTo().performClick()

        assertTrue("tapping the phone permission row must request it", asked)
    }

    @Test
    fun `the SIM card's warning is a way out, not just a complaint`() {
        /*
         * Somebody who has scrolled to the SIM list is the person who most
         * wants this permission, and the version that shipped told them what
         * was wrong and offered nothing to press.
         */
        var asked = false
        show(UiState(hasPhoneStatePermission = false), onPhone = { asked = true })

        compose.onNodeWithText("Phone permission not granted").performScrollTo().performClick()

        assertTrue("the SIM list's warning must request the permission", asked)
    }

    @Test
    fun `each permission row asks for its own permission and no other`() {
        /*
         * Guards the copy-paste failure this section invites: four near
         * identical rows, and one of them wired to the callback above it.
         */
        val asked = mutableListOf<String>()
        show(
            UiState(),
            onSms = { asked += "sms" },
            onPhone = { asked += "phone" },
            onNotifications = { asked += "notifications" },
            onBattery = { asked += "battery" },
        )

        compose.onNodeWithText("Notification access").performScrollTo().performClick()
        compose.onNodeWithText("SMS permission").performScrollTo().performClick()
        compose.onNodeWithText("Phone permission").performScrollTo().performClick()
        compose.onNodeWithText("Battery optimisation").performScrollTo().performClick()

        assertEquals(listOf("notifications", "sms", "phone", "battery"), asked)
    }

    @Test
    fun `a granted permission still shows its row`() {
        // Hiding a satisfied permission would make the checklist unreadable:
        // somebody checking whether this phone is set up correctly needs to see
        // the tick, not an absence they have to interpret.
        show(UiState(hasPhoneStatePermission = true, hasSmsPermission = true))

        compose.onNodeWithText("Phone permission").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("SMS permission").performScrollTo().assertIsDisplayed()
    }

    @Test
    fun `a connected phone can be disconnected, and is told what that does not do`() {
        /*
         * The only way to shed the account-less business pairing.
         *
         * A wallet's Remove drops that one number, and the pairing the phone
         * scanned with has no screen of its own — so without this a phone could
         * lose every wallet and still consider itself connected, with no way
         * back but clearing the app's data.
         */
        val removed = mutableListOf<String>()
        show(
            UiState(
                pairings = listOf(
                    Pairing(
                        deviceId = "business",
                        deviceToken = "t",
                        serverUrl = "https://pay.example.com",
                        accountMsisdn = null,
                        provider = null,
                        awaitingApproval = false,
                    ),
                    Pairing(
                        deviceId = "bkash",
                        deviceToken = "t",
                        serverUrl = "https://pay.example.com",
                        accountMsisdn = "8801714205878",
                        provider = "bkash",
                        awaitingApproval = false,
                    ),
                ),
            ),
            onRemovePairing = { removed += it },
        )

        compose.onNodeWithText("Disconnect this phone").performScrollTo().performClick()
        // Named honestly: nothing on a phone can revoke a credential on a
        // server somebody else runs, and pretending otherwise is the worse lie.
        compose.onNodeWithText("Disconnect this phone?").assertIsDisplayed()
        compose.onNodeWithText("Disconnect").performClick()

        assertEquals(listOf("business", "bkash"), removed)
    }

    @Test
    fun `an unpaired phone is not offered a disconnect`() {
        show(UiState())
        compose.onNodeWithText("Disconnect this phone").assertDoesNotExist()
    }
}
