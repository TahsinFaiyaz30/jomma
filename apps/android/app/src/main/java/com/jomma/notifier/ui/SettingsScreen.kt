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
import androidx.compose.material.icons.outlined.Download
import androidx.compose.material.icons.outlined.FilterAlt
import androidx.compose.material.icons.outlined.NotificationsActive
import androidx.compose.material.icons.outlined.Person
import androidx.compose.material.icons.outlined.QrCodeScanner
import androidx.compose.material.icons.outlined.Schedule
import androidx.compose.material.icons.outlined.Security
import androidx.compose.material.icons.outlined.Shield
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
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.jomma.notifier.BuildConfig
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
    onRequestBatteryExemption: () -> Unit,
    onOpenAutoStart: () -> Unit,
    onScan: () -> Unit,
    onCaptureChange: (CaptureSettings) -> Unit,
    onIntervalChange: (UpdateInterval) -> Unit,
    onAutoDownloadChange: (Boolean) -> Unit,
    onUnmeteredOnlyChange: (Boolean) -> Unit,
    onCheckForUpdates: () -> Unit,
    onInstallUpdate: () -> Unit,
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

        SectionHeader("What to capture")
        SettingsCard {
            ListItem(
                leadingContent = { Icon(Icons.Outlined.FilterAlt, contentDescription = null) },
                headlineContent = { Text("Incoming Send Money") },
                supportingContent = { Text("The only type that can settle an order.") },
                trailingContent = { Text("always", style = MaterialTheme.typography.labelLarge) },
                colors = ListItemDefaults.colors(containerColor = Color.Transparent),
            )
            HorizontalDivider()
            SwitchRow(
                title = "Cash In",
                subtitle = "Top-ups from an agent or your bank.",
                checked = state.capture.cashIn,
                enabled = !state.captureSaving,
                onChange = { onCaptureChange(state.capture.copy(cashIn = it)) },
            )
            HorizontalDivider()
            SwitchRow(
                title = "Money you sent",
                subtitle = "A ledger of outgoing transfers. Never matched to an order.",
                checked = state.capture.outgoing,
                enabled = !state.captureSaving,
                onChange = { onCaptureChange(state.capture.copy(outgoing = it)) },
            )
            HorizontalDivider()
            SwitchRow(
                title = "Everything else",
                subtitle = "Promotions and balance notices. Usually noise.",
                checked = state.capture.other,
                enabled = !state.captureSaving,
                onChange = { onCaptureChange(state.capture.copy(other = it)) },
            )
        }

        SectionHeader("Updates")
        UpdatesSection(
            state = state,
            onIntervalChange = onIntervalChange,
            onAutoDownloadChange = onAutoDownloadChange,
            onUnmeteredOnlyChange = onUnmeteredOnlyChange,
            onCheckForUpdates = onCheckForUpdates,
            onInstallUpdate = onInstallUpdate,
        )

        SectionHeader("Device")
        SettingsCard {
            StatusRow(
                icon = Icons.Outlined.QrCodeScanner,
                title = "Provisioning",
                subtitle = state.serverUrl ?: "Not paired with a server yet",
                granted = state.provisioned && !state.revoked,
                onClick = onScan,
            )
        }

        SectionHeader("About")
        SettingsCard {
            InfoRow(Icons.Outlined.Person, "Developer", "Tahsin Faiyaz")
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
    onInstallUpdate: () -> Unit,
) {
    var pickingInterval by remember { mutableStateOf(false) }

    SettingsCard {
        // The offer, when there is one. Above the settings because somebody who
        // has just been told an update exists wants to act on it, not configure
        // how often they are told.
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
                    } else {
                        TextButton(onClick = onInstallUpdate) { Text("Install") }
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
            HorizontalDivider()
        }

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
        HorizontalDivider()
        ListItem(
            headlineContent = { Text("Check now") },
            supportingContent = {
                Text(state.updateStatus ?: "Currently on ${BuildConfig.VERSION_NAME}")
            },
            trailingContent = {
                if (state.updateChecking) {
                    CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
                }
            },
            leadingContent = { Icon(Icons.Outlined.SystemUpdate, contentDescription = null) },
            colors = ListItemDefaults.colors(containerColor = Color.Transparent),
            modifier = Modifier.clickable(enabled = !state.updateChecking, onClick = onCheckForUpdates),
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

@Composable
private fun SectionHeader(text: String) {
    Text(
        text,
        style = MaterialTheme.typography.labelLarge,
        color = MaterialTheme.colorScheme.primary,
        fontWeight = FontWeight.SemiBold,
        modifier = Modifier.padding(start = 24.dp, end = 24.dp, top = 20.dp, bottom = 6.dp),
    )
}

@Composable
private fun SettingsCard(content: @Composable () -> Unit) {
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
private fun SwitchRow(
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
