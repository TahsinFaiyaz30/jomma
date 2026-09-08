package com.jomma.notifier.ui

import android.app.Application
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
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
        onBusinessEnabledChange: (String, Boolean) -> Unit = { _, _ -> },
        onManageBusiness: (String) -> Unit = {},
        onDisconnectEverything: () -> Unit = {},
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
                    onBusinessEnabledChange = onBusinessEnabledChange,
                    onDisconnectEverything = onDisconnectEverything,
                    onManageBusiness = onManageBusiness,
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
    fun `disconnecting the phone leaves every business at once`() {
        /*
         * The phone-level act, and the only way to shed the account-less
         * business pairings — those have no screen of their own, so without
         * this a handset could lose every wallet and still consider itself
         * connected to four merchants.
         *
         * One action rather than a loop over the per-business one, because that
         * told somebody with four shops four times and never said whether any
         * had failed.
         */
        var disconnected = false
        show(
            UiState(
                pairings = listOf(
                    forBusiness("d1", "b1", "Karim Store", "8801714205878"),
                    forBusiness("d2", "b2", "Dhaka Electronics", "8801911223344"),
                ),
            ),
            onDisconnectEverything = { disconnected = true },
        )

        compose.onNodeWithText("Disconnect this phone").performScrollTo().performClick()
        compose.onNodeWithText("Disconnect this phone?").assertIsDisplayed()
        assertTrue("nothing happens until it is confirmed", !disconnected)

        compose.onNodeWithText("Disconnect").performClick()
        assertTrue(disconnected)
    }

    @Test
    fun `an unpaired phone is not offered a disconnect`() {
        show(UiState())
        compose.onNodeWithText("Disconnect this phone").assertDoesNotExist()
    }

    /* ── The business list ───────────────────────────────────────────────── */

    private fun forBusiness(
        deviceId: String,
        businessId: String,
        name: String,
        msisdn: String? = null,
        enabled: Boolean = true,
    ) = Pairing(
        deviceId = deviceId,
        deviceToken = "t",
        serverUrl = "https://pay.example.com",
        businessId = businessId,
        businessName = name,
        accountMsisdn = msisdn,
        provider = if (msisdn == null) null else "bkash",
        awaitingApproval = false,
        sendingEnabled = enabled,
    )

    @Test
    fun `every merchant this phone helps is listed under the button that adds one`() {
        /*
         * Settings is where phone-level things live, and "which shops does this
         * handset serve" is one of them. They all report at once — the phone
         * holds a credential each and beats them all — so this is a list of live
         * things, not one live and several dormant.
         */
        show(
            UiState(
                pairings = listOf(
                    forBusiness("d1", "b1", "Karim Store", "8801714205878"),
                    forBusiness("d2", "b2", "Dhaka Electronics", "8801911223344"),
                    forBusiness("d3", "b3", "Chittagong Outlet", "8801811556677", enabled = false),
                ),
            ),
        )

        compose.onNodeWithText("Businesses (3)").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("Karim Store").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("Dhaka Electronics").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("Chittagong Outlet").performScrollTo().assertIsDisplayed()
        // The paused one says what that costs, rather than merely being off.
        compose.onNodeWithText("Paused. Nothing is captured or held for it.")
            .performScrollTo()
            .assertIsDisplayed()
    }

    @Test
    fun `the switch reports which merchant it belongs to`() {
        var toggled: Pair<String, Boolean>? = null
        show(
            UiState(pairings = listOf(forBusiness("d1", "b1", "Karim Store", "8801714205878"))),
            onBusinessEnabledChange = { key, on -> toggled = key to on },
        )

        compose.onNodeWithContentDescription("Reporting for Karim Store")
            .performScrollTo()
            .performClick()

        // Keyed by business, not by number: a shop closing is one decision, and
        // doing it a number at a time left it half-off whenever one was missed.
        assertEquals("b1" to false, toggled)
    }

    @Test
    fun `tapping a merchant opens its page without changing which one is showing`() {
        /*
         * Two different questions that used to be one answer.
         *
         * Looking at a shop's settings is not deciding which shop you are
         * watching. Tapping here used to switch the status screen underneath,
         * so a glance at one merchant quietly re-pointed the screen somebody
         * would come back to — and, worse, the "add a wallet" flow reads the
         * showing business, so a number added afterwards would have landed on
         * whichever shop the glance had selected.
         *
         * Switching is the status card's dropdown, and only that.
         */
        var opened: String? = null
        show(
            UiState(
                pairings = listOf(
                    forBusiness("d1", "b1", "Karim Store", "8801714205878"),
                    forBusiness("d2", "b2", "Dhaka Electronics", "8801911223344"),
                ),
                activeBusinessKey = "b1",
            ),
            onManageBusiness = { opened = it },
        )

        compose.onNodeWithText("Dhaka Electronics").performScrollTo().performClick()

        // The one it was tapped on, and nothing else. That it *cannot* switch
        // is structural rather than asserted: this screen is no longer given a
        // way to, so there is nothing here to call by mistake.
        assertEquals("b2", opened)
    }

    @Test
    fun `the switch is not the row, so turning one off does not open it`() {
        // They are a few pixels apart and mean opposite things: one stops a
        // merchant being watched, the other just looks at it.
        var opened: String? = null
        show(
            UiState(pairings = listOf(forBusiness("d1", "b1", "Karim Store", "8801714205878"))),
            onManageBusiness = { opened = it },
        )

        compose.onNodeWithContentDescription("Reporting for Karim Store")
            .performScrollTo()
            .performClick()

        assertEquals(null, opened)
    }

    @Test
    fun `an unpaired phone is invited to connect one rather than shown an empty list`() {
        show(UiState())
        compose.onNodeWithText("Pair this phone").performScrollTo().assertIsDisplayed()
    }
}
