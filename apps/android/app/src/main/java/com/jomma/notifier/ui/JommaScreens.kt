package com.jomma.notifier.ui

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Article
import androidx.compose.material.icons.automirrored.outlined.Send
import androidx.compose.material.icons.filled.Bolt
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Error
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material.icons.outlined.BatteryChargingFull
import androidx.compose.material.icons.outlined.CloudUpload
import androidx.compose.material.icons.outlined.FilterAlt
import androidx.compose.material.icons.outlined.Monitor
import androidx.compose.material.icons.outlined.MonitorHeart
import androidx.compose.material.icons.outlined.NotificationsActive
import androidx.compose.material.icons.outlined.QrCodeScanner
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material.icons.outlined.Shield
import androidx.compose.material.icons.outlined.Sms
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ElevatedCard
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.ListItem
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.jomma.notifier.data.Capture
import com.jomma.notifier.net.CaptureSettings
import com.jomma.notifier.update.UpdateInterval
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Three destinations. Deliberately plain — nobody uses this app, they check it.
 *
 * Everything structural uses Material colour roles, so on Android 12+ the whole
 * thing re-tints to the wallpaper. The status colours are the exception and are
 * fixed on purpose; see Theme.kt.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun JommaScreens(
    state: UiState,
    captures: List<Capture>,
    snackbarHost: SnackbarHostState,
    destination: Int,
    onDestinationChange: (Int) -> Unit,
    onScan: () -> Unit,
    onOpenNotificationSettings: () -> Unit,
    onRequestSms: () -> Unit,
    onRequestBatteryExemption: () -> Unit,
    onOpenAutoStart: () -> Unit,
    onIntervalChange: (UpdateInterval) -> Unit,
    onAutoDownloadChange: (Boolean) -> Unit,
    onUnmeteredOnlyChange: (Boolean) -> Unit,
    onCheckForUpdates: () -> Unit,
    onInstallUpdate: () -> Unit,
    onOpenGitHub: () -> Unit,
    onFlush: () -> Unit,
    onHeartbeat: () -> Unit,
    onTestCapture: () -> Unit,
    onCaptureChange: (String, CaptureSettings) -> Unit,
    onRemovePairing: (String) -> Unit,
) {
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(if (destination == 1) "Log" else if (destination == 2) "Settings" else "Jomma Notifier") },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.surface,
                    titleContentColor = MaterialTheme.colorScheme.onSurface,
                ),
            )
        },
        bottomBar = {
            NavigationBar {
                NavigationBarItem(
                    selected = destination == 0,
                    onClick = { onDestinationChange(0) },
                    icon = { Icon(Icons.Outlined.MonitorHeart, contentDescription = null) },
                    label = { Text("Status") },
                )
                NavigationBarItem(
                    selected = destination == 1,
                    onClick = { onDestinationChange(1) },
                    icon = { Icon(Icons.AutoMirrored.Outlined.Article, contentDescription = null) },
                    label = { Text("Log") },
                )
                NavigationBarItem(
                    selected = destination == 2,
                    onClick = { onDestinationChange(2) },
                    icon = { Icon(Icons.Outlined.Settings, contentDescription = null) },
                    label = { Text("Settings") },
                )
            }
        },
        snackbarHost = { SnackbarHost(snackbarHost) },
    ) { padding ->
        Box(Modifier.padding(padding)) {
            when (destination) {
                0 -> StatusScreen(state, onScan, onFlush, onHeartbeat, onTestCapture)
                1 -> LogScreen(captures)
                else -> SettingsScreen(
                    state = state,
                    onOpenNotificationSettings = onOpenNotificationSettings,
                    onRequestSms = onRequestSms,
                    onRequestBatteryExemption = onRequestBatteryExemption,
                    onOpenAutoStart = onOpenAutoStart,
                    onScan = onScan,
                    onCaptureChange = onCaptureChange,
                    onRemovePairing = onRemovePairing,
                    onIntervalChange = onIntervalChange,
                    onAutoDownloadChange = onAutoDownloadChange,
                    onUnmeteredOnlyChange = onUnmeteredOnlyChange,
                    onCheckForUpdates = onCheckForUpdates,
                    onInstallUpdate = onInstallUpdate,
                    onOpenGitHub = onOpenGitHub,
                )
            }
        }
    }
}

/** One glance answers "is it working?". The status card is the whole product. */
@Composable
private fun StatusScreen(
    state: UiState,
    onScan: () -> Unit,
    onFlush: () -> Unit,
    onHeartbeat: () -> Unit,
    onTestCapture: () -> Unit,
) {
    val status = LocalStatusColors.current

    val container by animateColorAsState(
        targetValue = when (state.health) {
            Health.Connected -> status.connectedContainer
            Health.Degraded -> status.degradedContainer
            Health.Down -> status.downContainer
        },
        label = "statusContainer",
    )
    val accent = when (state.health) {
        Health.Connected -> status.connected
        Health.Degraded -> status.degraded
        Health.Down -> status.down
    }
    val icon: ImageVector = when (state.health) {
        Health.Connected -> Icons.Filled.CheckCircle
        Health.Degraded -> Icons.Filled.Warning
        Health.Down -> Icons.Filled.Error
    }

    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        ElevatedCard(
            colors = CardDefaults.elevatedCardColors(containerColor = container),
            modifier = Modifier.fillMaxWidth(),
        ) {
            Row(
                Modifier.padding(20.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                Icon(icon, contentDescription = null, tint = accent, modifier = Modifier.size(40.dp))
                Column {
                    Text(
                        when (state.health) {
                            Health.Connected -> "Connected"
                            Health.Degraded -> "Needs attention"
                            Health.Down -> "Not working"
                        },
                        style = MaterialTheme.typography.headlineSmall,
                        fontWeight = FontWeight.SemiBold,
                    )
                    Text(
                        when {
                            !state.provisioned -> "Not provisioned yet"
                            // Named while there is one, counted after that: with
                            // three numbers the list belongs on Settings, not in
                            // a status line.
                            state.awaitingApproval.isNotEmpty() && state.livePairings.isEmpty() ->
                                "Waiting for approval on the dashboard"
                            state.livePairings.isEmpty() -> "Revoked — pair this phone again"
                            !state.hasNotificationAccess -> "Notification access is off"
                            state.queueDepth > 0 -> "${state.queueDepth} waiting to send"
                            state.livePairings.size == 1 ->
                                "Watching ${state.livePairings.first().accountMsisdn}"
                            else -> "Watching ${state.livePairings.size} numbers"
                        },
                        style = MaterialTheme.typography.bodyMedium,
                    )
                }
            }
        }

        if (!state.provisioned) {
            Card(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text("Set this device up", style = MaterialTheme.typography.titleMedium)
                    Text(
                        "Open Accounts in the Jomma dashboard, add a device, and scan the code it " +
                            "shows. Any QR scanner will do — it opens straight back here.",
                        style = MaterialTheme.typography.bodyMedium,
                    )
                    FilledTonalButton(onClick = onScan, enabled = !state.busy) {
                        Icon(Icons.Outlined.QrCodeScanner, contentDescription = null)
                        Spacer(Modifier.width(8.dp))
                        Text("Scan provisioning code")
                    }
                }
            }
            return@Column
        }

        Card(Modifier.fillMaxWidth()) {
            Column {
                StatListItem(Icons.Outlined.CloudUpload, "Last capture", state.lastCaptureAt?.let(::ago) ?: "never")
                HorizontalDivider()
                StatListItem(Icons.Filled.Bolt, "Last heartbeat", if (state.lastHeartbeatAt == 0L) "never" else ago(state.lastHeartbeatAt))
                HorizontalDivider()
                StatListItem(Icons.AutoMirrored.Outlined.Send, "Queue", "${state.queueDepth} pending")
                HorizontalDivider()
                StatListItem(Icons.Outlined.Monitor, "Today", "${state.capturedToday} captured")
            }
        }

        if (state.queueDepth > 0) {
            val progress by animateFloatAsState(
                targetValue = (state.queueDepth.coerceAtMost(50) / 50f),
                label = "queue",
            )
            LinearProgressIndicator(
                progress = { progress },
                modifier = Modifier.fillMaxWidth(),
            )
        }

        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
            FilledTonalButton(onClick = onTestCapture, modifier = Modifier.weight(1f)) {
                Text("Test capture")
            }
            OutlinedButton(onClick = onFlush, modifier = Modifier.weight(1f)) {
                Icon(Icons.Outlined.Refresh, contentDescription = null)
                Spacer(Modifier.width(8.dp))
                Text("Flush")
            }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
            OutlinedButton(onClick = onHeartbeat, modifier = Modifier.weight(1f)) { Text("Heartbeat") }
            /*
             * "Add a number" where "Re-provision" used to be. Tearing the phone
             * down wholesale is no longer a sensible action when it may be
             * watching three numbers; removing one specifically lives on
             * Settings, beside the number it would remove.
             */
            OutlinedButton(onClick = onScan, modifier = Modifier.weight(1f)) { Text("Add a number") }
        }
    }
}

@Composable
private fun StatListItem(icon: ImageVector, label: String, value: String) {
    ListItem(
        leadingContent = { Icon(icon, contentDescription = null) },
        headlineContent = { Text(label) },
        trailingContent = { Text(value, style = MaterialTheme.typography.labelLarge) },
        colors = ListItemDefaults.colors(containerColor = Color.Transparent),
    )
}

/**
 * Recent captures with delivery status. Raw text is visible on purpose: when the
 * parser breaks, this is where you read what actually arrived.
 */
@Composable
private fun LogScreen(captures: List<Capture>) {
    val status = LocalStatusColors.current

    if (captures.isEmpty()) {
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Icon(
                    Icons.AutoMirrored.Outlined.Article,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.size(48.dp),
                )
                Spacer(Modifier.height(12.dp))
                Text("Nothing captured yet", style = MaterialTheme.typography.titleMedium)
                Text(
                    "Messages appear here the moment they arrive.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        return
    }

    LazyColumn(
        Modifier.fillMaxSize(),
        contentPadding = androidx.compose.foundation.layout.PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        items(captures, key = { it.localId }) { capture ->
            /*
             * "sent" is not the whole truth once capture settings exist. A
             * filtered message was delivered and then deliberately discarded, so
             * saying "sent" would send someone hunting a delivery bug for a row
             * that is missing from the dashboard exactly as they asked.
             */
            val label = when {
                !capture.sent -> "queued"
                capture.outcome == "filtered" -> "filtered out"
                capture.outcome == "duplicate" -> "duplicate"
                capture.outcome == "unparsed" -> "could not be read"
                else -> "sent"
            }
            val tint = when {
                !capture.sent -> status.degraded
                capture.outcome == "unparsed" -> status.down
                capture.outcome == "filtered" -> MaterialTheme.colorScheme.onSurfaceVariant
                else -> status.connected
            }

            Card(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        Box(
                            Modifier
                                .size(8.dp)
                                .clip(CircleShape)
                                .background(tint),
                        )
                        Text(
                            label,
                            style = MaterialTheme.typography.labelMedium,
                            color = tint,
                        )
                        Text(capture.source, style = MaterialTheme.typography.labelMedium)
                        Spacer(Modifier.weight(1f))
                        Text(
                            clock(capture.capturedAt),
                            style = MaterialTheme.typography.labelMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    Text(
                        capture.raw,
                        style = MaterialTheme.typography.bodySmall,
                        fontFamily = FontFamily.Monospace,
                    )
                    if (capture.attempts > 0 || capture.lastError != null) {
                        Text(
                            listOfNotNull(
                                if (capture.attempts > 0) "${capture.attempts} attempts" else null,
                                capture.lastError,
                            ).joinToString(" · "),
                            style = MaterialTheme.typography.labelSmall,
                            color = status.down,
                        )
                    }
                }
            }
        }
    }
}


@Composable
fun JommaSurface(content: @Composable () -> Unit) {
    Surface(color = MaterialTheme.colorScheme.background, content = content)
}

private fun ago(timestamp: Long): String {
    val seconds = (System.currentTimeMillis() - timestamp) / 1000
    return when {
        seconds < 60 -> "${seconds}s ago"
        seconds < 3600 -> "${seconds / 60} min ago"
        seconds < 86400 -> "${seconds / 3600} h ago"
        else -> "${seconds / 86400} d ago"
    }
}

private fun clock(timestamp: Long): String =
    SimpleDateFormat("HH:mm:ss", Locale.getDefault()).format(Date(timestamp))
