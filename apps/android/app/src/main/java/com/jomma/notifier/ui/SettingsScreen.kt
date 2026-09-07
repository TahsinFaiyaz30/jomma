package com.jomma.notifier.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.OpenInNew
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Error
import androidx.compose.material.icons.outlined.BatteryChargingFull
import androidx.compose.material.icons.outlined.Code
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.Download
import androidx.compose.material.icons.outlined.FilterAlt
import androidx.compose.material.icons.outlined.NotificationsActive
import androidx.compose.material.icons.outlined.Person
import androidx.compose.material.icons.outlined.Phone
import androidx.compose.material.icons.outlined.QrCodeScanner
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material.icons.outlined.Schedule
import androidx.compose.material.icons.outlined.Security
import androidx.compose.material.icons.outlined.Shield
import androidx.compose.material.icons.outlined.SimCard
import androidx.compose.material.icons.outlined.Sms
import androidx.compose.material.icons.outlined.SystemUpdate
import androidx.compose.material.icons.outlined.Wifi
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.ListItem
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.Warning
import com.jomma.notifier.data.Attribution
import com.jomma.notifier.data.Pairing
import com.jomma.notifier.data.SimCard
import androidx.compose.foundation.layout.height
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.jomma.notifier.BuildConfig
import com.jomma.notifier.R
import com.jomma.notifier.net.CaptureSettings
import com.jomma.notifier.update.UpdateInterval

/**
 * Everything configurable, in one screen with a shape.
 *
 * The previous version was a flat stack of identical cards: permissions,
 * provisioning and capture settings all looked the same and read in no
 * particular order, so nothing signalled what mattered or what belonged
 * together. This groups them — what must be granted, what to capture, updates,
 * about — with a heading per group and one row per setting.
 *
 * Rows carry Material icons because a wall of text is slower to scan than a
 * column of glyphs, and because a checklist where every line looks identical is
 * one people stop reading.
 */
@Composable
fun SettingsScreen(
    state: UiState,
    onOpenNotificationSettings: () -> Unit,
    onRequestSms: () -> Unit,
    /** Needed by the SIM list, and offered nowhere until it was missing. */
    onRequestPhone: () -> Unit,
    onRequestBatteryExemption: () -> Unit,
    onOpenAutoStart: () -> Unit,
    onScan: () -> Unit,
    /** Keyed by device id: settings belong to a number, not to the app. */
    onCaptureChange: (String, CaptureSettings) -> Unit,
    /** Keyed by device id: pausing is per number, never for the whole phone. */
    onSendingChange: (String, Boolean) -> Unit,
    onRemovePairing: (String) -> Unit,
    onIntervalChange: (UpdateInterval) -> Unit,
    onAutoDownloadChange: (Boolean) -> Unit,
    onUnmeteredOnlyChange: (Boolean) -> Unit,
    onCheckForUpdates: () -> Unit,
    onDownloadUpdate: () -> Unit,
    onInstallUpdate: () -> Unit,
    onDeleteDownload: () -> Unit,
    onOpenGitHub: () -> Unit,
) {
    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(bottom = 24.dp),
    ) {
        /*
         * Permissions first, and in the order they matter. Notification access
         * is the whole product; without it the app captures nothing at all, so
         * it cannot be third in an alphabetical list.
         */
        SectionHeader("Permissions")
        SettingsCard {
            StatusRow(
                icon = Icons.Outlined.NotificationsActive,
                title = "Notification access",
                subtitle = "The primary capture path. Without it nothing is captured.",
                granted = state.hasNotificationAccess,
                onClick = onOpenNotificationSettings,
            )
            HorizontalDivider()
            StatusRow(
                icon = Icons.Outlined.Sms,
                title = "SMS permission",
                subtitle = "The second path. Catches what notifications miss.",
                granted = state.hasSmsPermission,
                onClick = onRequestSms,
            )
            HorizontalDivider()
            /*
             * The one that was missing.
             *
             * `READ_PHONE_STATE` and `READ_PHONE_NUMBERS` were in the manifest
             * and checked by `SimInventory`, and no screen ever asked for them.
             * Choosing which number a phone watches is done by picking one of
             * its SIMs, so without this the list is empty, the dashboard has
             * nothing to offer, and the only route through was knowing to grant
             * it by hand in Android's app info.
             */
            StatusRow(
                // A handset, not a SIM card. This is Android's *Phone*
                // permission group, and a SIM icon here collided with the SIM
                // list further down the same screen.
                icon = Icons.Outlined.Phone,
                title = "Phone permission",
                subtitle = "Reads which SIMs are in this phone, and their numbers. " +
                    "Without it there is no number to choose.",
                granted = state.hasPhoneStatePermission,
                onClick = onRequestPhone,
            )
        }

        SectionHeader("Staying alive")
        SettingsCard {
            StatusRow(
                icon = Icons.Outlined.BatteryChargingFull,
                title = "Battery optimisation",
                subtitle = if (state.batteryExempt) {
                    "Android has been told to leave this app running."
                } else {
                    "Android will eventually stop this app in the background."
                },
                granted = state.batteryExempt,
                onClick = onRequestBatteryExemption,
            )
            if (state.aggressiveVendor) {
                HorizontalDivider()
                StatusRow(
                    icon = Icons.Outlined.Shield,
                    title = "${state.vendorLabel} app launch",
                    subtitle = "${state.vendorLabel} runs its own background-app manager. " +
                        "Turn off \"manage automatically\", then allow auto-launch and " +
                        "background running.",
                    // No API reports a vendor killer's state. Showing a tick or
                    // a cross here would be inventing one.
                    granted = null,
                    onClick = onOpenAutoStart,
                )
            }
        }

        /*
         * No list of numbers here.
         *
         * It used to be the bulk of this screen: a card per watched number,
         * with that number's capture rules, its SIM binding and its pause
         * switch. Wrong place, twice over. Settings is where things that are
         * true of *this phone* live — permissions, keeping the service alive,
         * updates — and a bKash account's capture rules are true of the
         * account, not of the handset holding it. And it duplicated the wallet
         * list on Status, so the same account appeared in two places with a
         * different amount of detail in each and no way to tell which was
         * authoritative.
         *
         * Each wallet now has its own screen, opened from Manage on Status.
         * See [WalletScreen].
         */

        /*
         * What this phone can see, whether or not anything is bound to it.
         *
         * Here because the dashboard shows the same list when somebody is
         * choosing a number, and the two disagreeing is exactly the failure
         * this whole flow exists to prevent — so it has to be checkable from
         * the phone as well as from a browser.
         */
        SectionHeader("SIMs in this phone")
        SettingsCard {
            if (!state.hasPhoneStatePermission) {
                // Clickable, because the version that was not simply told
                // somebody what was wrong and left them there.
                ListItem(
                    leadingContent = { Icon(Icons.Outlined.Warning, contentDescription = null) },
                    headlineContent = { Text("Phone permission not granted") },
                    supportingContent = {
                        Text("Without it the SIMs cannot be read, and the dashboard has none to " +
                            "offer. Tap to grant it.")
                    },
                    colors = ListItemDefaults.colors(containerColor = Color.Transparent),
                    modifier = Modifier.clickable(onClick = onRequestPhone),
                )
            } else if (state.sims.isEmpty()) {
                ListItem(
                    leadingContent = { Icon(Icons.Outlined.SimCard, contentDescription = null) },
                    headlineContent = { Text("No SIMs found") },
                    supportingContent = { Text("Nothing to report. Check a SIM is inserted.") },
                    colors = ListItemDefaults.colors(containerColor = Color.Transparent),
                )
            } else {
                state.sims.forEachIndexed { index, sim ->
                    if (index > 0) HorizontalDivider()
                    ListItem(
                        leadingContent = { Icon(Icons.Outlined.SimCard, contentDescription = null) },
                        headlineContent = {
                            Text("SIM ${sim.slotIndex + 1} · ${sim.carrierName}")
                        },
                        supportingContent = {
                            Text(
                                if (sim.msisdn != null) {
                                    "${sim.msisdn} · ${sim.networkGeneration} · from ${sim.numberSource}"
                                } else {
                                    // Not a fault to fix. The carrier never wrote
                                    // the number to the SIM, and no API invents it.
                                    "Number not available · ${sim.networkGeneration}"
                                },
                            )
                        },
                        colors = ListItemDefaults.colors(containerColor = Color.Transparent),
                    )
                }
            }
        }

        Spacer(Modifier.height(8.dp))

        SettingsCard {
            ListItem(
                leadingContent = { Icon(Icons.Outlined.Add, contentDescription = null) },
                headlineContent = {
                    Text(if (state.pairings.isEmpty()) "Pair this phone" else "Scan another code")
                },
                supportingContent = {
                    // Says what scanning does. It connects the phone; the number
                    // it watches is chosen afterwards, in the dashboard.
                    Text(
                        "Scan the code from the Jomma dashboard. You choose which SIM it is " +
                            "paid on there, so there is nothing to fill in here.",
                    )
                },
                colors = ListItemDefaults.colors(containerColor = Color.Transparent),
                modifier = Modifier.clickable(onClick = onScan),
            )

            /*
             * Disconnecting the whole phone, which is a phone-level act and so
             * belongs here rather than on a wallet's screen.
             *
             * A wallet's own Remove drops that one number. This drops the lot,
             * including the account-less business pairing the phone scanned with
             * — which has no screen of its own, so without this a phone could
             * shed every wallet and still consider itself connected, with no way
             * back but clearing the app's data.
             *
             * Local only, and it says so. Nothing here can revoke a credential
             * on somebody else's server; the dashboard does that, and claiming
             * otherwise would be the more dangerous lie.
             */
            if (state.pairings.isNotEmpty()) {
                HorizontalDivider()
                var confirming by remember { mutableStateOf(false) }

                ListItem(
                    leadingContent = { Icon(Icons.Outlined.Delete, contentDescription = null) },
                    headlineContent = { Text("Disconnect this phone") },
                    supportingContent = {
                        Text("Forgets every wallet and the pairing itself. Revoke it on the dashboard too.")
                    },
                    colors = ListItemDefaults.colors(containerColor = Color.Transparent),
                    modifier = Modifier.clickable { confirming = true },
                )

                if (confirming) {
                    AlertDialog(
                        onDismissRequest = { confirming = false },
                        title = { Text("Disconnect this phone?") },
                        text = {
                            Text(
                                "It stops capturing for " +
                                    "${state.pairings.count { it.accountMsisdn != null }} wallet(s) " +
                                    "and forgets its credentials. Anything not yet sent is lost. " +
                                    "Revoke it on the dashboard as well, or the server will go on " +
                                    "listing it until it does.",
                            )
                        },
                        confirmButton = {
                            TextButton(
                                onClick = {
                                    confirming = false
                                    // A snapshot: removing walks the same list.
                                    for (id in state.pairings.map { it.deviceId }) onRemovePairing(id)
                                },
                            ) { Text("Disconnect") }
                        },
                        dismissButton = {
                            TextButton(onClick = { confirming = false }) { Text("Cancel") }
                        },
                    )
                }
            }
        }

        SectionHeader("Updates")
        UpdatesSection(
            state = state,
            onIntervalChange = onIntervalChange,
            onAutoDownloadChange = onAutoDownloadChange,
            onUnmeteredOnlyChange = onUnmeteredOnlyChange,
            onCheckForUpdates = onCheckForUpdates,
            onDownloadUpdate = onDownloadUpdate,
            onInstallUpdate = onInstallUpdate,
            onDeleteDownload = onDeleteDownload,
        )

        SectionHeader("About")
        SettingsCard {
            InfoRow(Icons.Outlined.Person, "Developer", stringResource(R.string.developer_name))
            HorizontalDivider()
            InfoRow(
                Icons.Outlined.Code,
                "Version",
                "${BuildConfig.VERSION_NAME} (${BuildConfig.VERSION_CODE}) · ${
                    if (BuildConfig.DEBUG) "debug" else "release"
                }",
            )
            HorizontalDivider()
            InfoRow(Icons.Outlined.Security, "Package", BuildConfig.APPLICATION_ID)
            HorizontalDivider()
            ListItem(
                leadingContent = {
                    Icon(Icons.AutoMirrored.Outlined.OpenInNew, contentDescription = null)
                },
                headlineContent = { Text("Source code") },
                supportingContent = { Text("github.com/TahsinFaiyaz30/jomma") },
                colors = ListItemDefaults.colors(containerColor = Color.Transparent),
                modifier = Modifier.clickable(onClick = onOpenGitHub),
            )
        }

        Text(
            "Jomma watches a bKash number and tells your store when money arrives. " +
                "It never moves money and never sees a PIN.",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(horizontal = 24.dp, vertical = 12.dp),
        )
    }
}

@Composable
private fun UpdatesSection(
    state: UiState,
    onIntervalChange: (UpdateInterval) -> Unit,
    onAutoDownloadChange: (Boolean) -> Unit,
    onUnmeteredOnlyChange: (Boolean) -> Unit,
    onCheckForUpdates: () -> Unit,
    onDownloadUpdate: () -> Unit,
    onInstallUpdate: () -> Unit,
    onDeleteDownload: () -> Unit,
) {
    var pickingInterval by remember { mutableStateOf(false) }

    SettingsCard {
        /*
         * The offer first when there is one, then "Check now", then how it
         * behaves.
         *
         * "Check now" used to be last, under two switches and an interval
         * picker, which buried the one thing somebody opens this section to
         * press. But it does not belong at the very top either: when there is an
         * update waiting, *that* is what the section is about, and asking again
         * is the lesser thing. So the order is: what is waiting, how to ask,
         * how to behave.
         */
        state.availableUpdate?.let { update ->
            ListItem(
                leadingContent = {
                    Icon(
                        Icons.Outlined.SystemUpdate,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.primary,
                    )
                },
                headlineContent = {
                    Text("Version $update", fontWeight = FontWeight.SemiBold)
                },
                supportingContent = {
                    Text(
                        if (state.updateDownloading) {
                            "Downloading…"
                        } else {
                            state.updateStatus ?: "Ready to install"
                        },
                    )
                },
                trailingContent = {
                    if (state.updateDownloading) {
                        CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
                    } else if (state.updateDownloaded) {
                        TextButton(onClick = onInstallUpdate) { Text("Install") }
                    } else {
                        /*
                         * Says what the press will actually do. The action behind
                         * it always downloaded first when it had to, but it called
                         * itself "Install" either way -- so the first press on a
                         * fresh update spent twelve megabytes of somebody's data
                         * and installed nothing, with no warning that it would.
                         */
                        TextButton(onClick = onDownloadUpdate) { Text("Download") }
                    }
                },
                colors = ListItemDefaults.colors(containerColor = Color.Transparent),
            )
            if (state.updateDownloading && state.updateProgress > 0) {
                LinearProgressIndicator(
                    progress = { state.updateProgress / 100f },
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp),
                )
            }

            // Only worth offering once there is a file to remove. Twelve
            // megabytes held for an update somebody has decided not to take is
            // otherwise unreachable without clearing the app's storage, which
            // would take the pairings with it.
            if (state.updateDownloaded && !state.updateDownloading) {
                HorizontalDivider()
                ListItem(
                    leadingContent = { Icon(Icons.Outlined.Delete, contentDescription = null) },
                    headlineContent = { Text("Delete download") },
                    supportingContent = {
                        Text("Frees the space. The update stays on offer.")
                    },
                    colors = ListItemDefaults.colors(containerColor = Color.Transparent),
                    modifier = Modifier.clickable(onClick = onDeleteDownload),
                )
            }
            HorizontalDivider()
        }

        /*
         * A different icon and a different sentence from the offer above.
         *
         * Both rows used `SystemUpdate` and both printed the same status string,
         * so they read as the same row twice — "Downloaded · ready to install"
         * appeared under a button that does not install anything. This one is
         * about *asking*: a refresh glyph, and the answer to the question.
         */
        ListItem(
            leadingContent = { Icon(Icons.Outlined.Refresh, contentDescription = null) },
            headlineContent = { Text("Check now") },
            supportingContent = {
                Text(state.checkStatus ?: "Currently on ${BuildConfig.VERSION_NAME}")
            },
            trailingContent = {
                if (state.updateChecking) {
                    CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
                }
            },
            colors = ListItemDefaults.colors(containerColor = Color.Transparent),
            modifier = Modifier.clickable(
                enabled = !state.updateChecking,
                onClick = onCheckForUpdates,
            ),
        )
        HorizontalDivider()
        ListItem(
            leadingContent = { Icon(Icons.Outlined.Schedule, contentDescription = null) },
            headlineContent = { Text("Check for updates") },
            supportingContent = { Text(UpdateInterval.from(state.updateInterval).label) },
            colors = ListItemDefaults.colors(containerColor = Color.Transparent),
            modifier = Modifier.clickable { pickingInterval = true },
        )
        HorizontalDivider()
        SwitchRow(
            title = "Download in advance",
            subtitle = "Fetch the update as soon as it is found, so installing is instant.",
            checked = state.autoDownloadUpdates,
            enabled = true,
            onChange = onAutoDownloadChange,
            icon = Icons.Outlined.Download,
        )
        HorizontalDivider()
        SwitchRow(
            title = "Wi-Fi only",
            subtitle = "Never spend mobile data on a download. Checking is unaffected.",
            checked = state.updatesOnUnmeteredOnly,
            enabled = true,
            onChange = onUnmeteredOnlyChange,
            icon = Icons.Outlined.Wifi,
        )
    }

    if (pickingInterval) {
        AlertDialog(
            onDismissRequest = { pickingInterval = false },
            title = { Text("Check for updates") },
            text = {
                Column {
                    for (option in UpdateInterval.entries) {
                        Row(
                            Modifier
                                .fillMaxWidth()
                                .clickable {
                                    onIntervalChange(option)
                                    pickingInterval = false
                                }
                                .padding(vertical = 10.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            RadioButton(
                                selected = UpdateInterval.from(state.updateInterval) == option,
                                onClick = {
                                    onIntervalChange(option)
                                    pickingInterval = false
                                },
                            )
                            Spacer(Modifier.width(8.dp))
                            Text(option.label)
                        }
                    }
                }
            },
            confirmButton = {
                TextButton(onClick = { pickingInterval = false }) { Text("Done") }
            },
        )
    }
}

/**
 * One watched number: what it is, whether it is working, and what it keeps.
 *
 * The status line is the important part. A number that has been scanned but not
 * approved looks identical to a working one from inside the app — it just
 * silently captures nothing — so it has to say so, and say what to do about it.
 */
@Composable
internal fun SectionHeader(text: String) {
    Text(
        text,
        style = MaterialTheme.typography.labelLarge,
        color = MaterialTheme.colorScheme.primary,
        fontWeight = FontWeight.SemiBold,
        modifier = Modifier.padding(start = 24.dp, end = 24.dp, top = 20.dp, bottom = 6.dp),
    )
}

@Composable
internal fun SettingsCard(content: @Composable () -> Unit) {
    Card(Modifier.fillMaxWidth().padding(horizontal = 12.dp)) { Column { content() } }
}

/**
 * A row whose state is known, shown as a tick or a cross.
 *
 * `granted = null` means genuinely unknowable — a vendor setting no API
 * reports. It draws a neutral dot rather than guessing, because a green tick
 * that is a guess is worse than no tick at all.
 */
@Composable
private fun StatusRow(
    icon: ImageVector,
    title: String,
    subtitle: String,
    granted: Boolean?,
    onClick: () -> Unit,
) {
    val status = LocalStatusColors.current
    val tint = when (granted) {
        true -> status.connected
        false -> status.down
        null -> MaterialTheme.colorScheme.onSurfaceVariant
    }

    ListItem(
        leadingContent = { Icon(icon, contentDescription = null, tint = tint) },
        headlineContent = { Text(title) },
        supportingContent = { Text(subtitle) },
        trailingContent = {
            when (granted) {
                true -> Icon(Icons.Filled.CheckCircle, contentDescription = "granted", tint = tint)
                false -> Icon(Icons.Filled.Error, contentDescription = "missing", tint = tint)
                null -> Box(
                    Modifier
                        .size(10.dp)
                        .clip(CircleShape)
                        .background(MaterialTheme.colorScheme.outlineVariant),
                )
            }
        },
        colors = ListItemDefaults.colors(containerColor = Color.Transparent),
        modifier = Modifier.clickable(onClick = onClick),
    )
}

@Composable
internal fun SwitchRow(
    title: String,
    subtitle: String,
    checked: Boolean,
    enabled: Boolean,
    onChange: (Boolean) -> Unit,
    icon: ImageVector? = null,
) {
    ListItem(
        leadingContent = icon?.let { { Icon(it, contentDescription = null) } },
        headlineContent = { Text(title) },
        supportingContent = { Text(subtitle) },
        trailingContent = {
            Switch(checked = checked, enabled = enabled, onCheckedChange = onChange)
        },
        colors = ListItemDefaults.colors(containerColor = Color.Transparent),
        modifier = Modifier.clickable(enabled = enabled) { onChange(!checked) },
    )
}

@Composable
private fun InfoRow(icon: ImageVector, title: String, value: String) {
    ListItem(
        leadingContent = { Icon(icon, contentDescription = null) },
        headlineContent = { Text(title) },
        supportingContent = { Text(value) },
        colors = ListItemDefaults.colors(containerColor = Color.Transparent),
    )
}
