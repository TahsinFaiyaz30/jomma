package com.jomma.notifier.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Tab
import androidx.compose.material3.TabRow
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.jomma.notifier.data.Capture
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

@Composable
fun JommaScreens(
    state: UiState,
    captures: List<Capture>,
    modifier: Modifier = Modifier,
    onScan: () -> Unit,
    onOpenNotificationSettings: () -> Unit,
    onRequestSms: () -> Unit,
    onOpenBatterySettings: () -> Unit,
    onFlush: () -> Unit,
    onHeartbeat: () -> Unit,
    onTestCapture: () -> Unit,
    onReprovision: () -> Unit,
) {
    var tab by remember { mutableIntStateOf(0) }
    val tabs = listOf("Status", "Log", "Setup")

    Column(modifier.fillMaxSize()) {
        TabRow(selectedTabIndex = tab) {
            tabs.forEachIndexed { index, title ->
                Tab(selected = tab == index, onClick = { tab = index }, text = { Text(title) })
            }
        }

        when (tab) {
            0 -> StatusScreen(state, onScan, onFlush, onHeartbeat, onTestCapture, onReprovision)
            1 -> LogScreen(captures)
            else -> SetupScreen(state, onOpenNotificationSettings, onRequestSms, onOpenBatterySettings, onScan)
        }
    }
}

/** One glance answers "is it working?". */
@Composable
private fun StatusScreen(
    state: UiState,
    onScan: () -> Unit,
    onFlush: () -> Unit,
    onHeartbeat: () -> Unit,
    onTestCapture: () -> Unit,
    onReprovision: () -> Unit,
) {
    Column(
        Modifier.fillMaxSize().padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(
                Modifier
                    .size(20.dp)
                    .background(
                        when (state.health) {
                            Health.Connected -> Color(0xFF2E9E5B)
                            Health.Degraded -> Color(0xFFD08B1E)
                            Health.Down -> Color(0xFFC0392B)
                        },
                        CircleShape,
                    ),
            )
            Text(
                text = "  " + when (state.health) {
                    Health.Connected -> "Connected"
                    Health.Degraded -> "Needs attention"
                    Health.Down -> "Not working"
                },
                style = MaterialTheme.typography.headlineSmall,
                fontWeight = FontWeight.Medium,
            )
        }

        if (state.revoked) {
            Card {
                Column(Modifier.padding(16.dp)) {
                    Text("This device was revoked", fontWeight = FontWeight.Medium)
                    Text(
                        "Captures are not being sent. Ask for a new provisioning code from the dashboard.",
                        style = MaterialTheme.typography.bodySmall,
                    )
                }
            }
        }

        if (!state.provisioned) {
            Card {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("Not provisioned", fontWeight = FontWeight.Medium)
                    Text(
                        "Open Accounts in the Jomma dashboard, add a device, and scan the code it shows.",
                        style = MaterialTheme.typography.bodySmall,
                    )
                    Button(onClick = onScan, enabled = !state.busy) { Text("Scan provisioning code") }
                }
            }
            return@Column
        }

        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            StatRow("Account", state.accountMsisdn ?: "—")
            StatRow("Last capture", state.lastCaptureAt?.let(::ago) ?: "never")
            StatRow("Last heartbeat", if (state.lastHeartbeatAt == 0L) "never" else ago(state.lastHeartbeatAt))
            StatRow("Queue", "${state.queueDepth} pending")
            StatRow("Today", "${state.capturedToday} captured")
        }

        HorizontalDivider()

        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(onClick = onTestCapture) { Text("Send test capture") }
            OutlinedButton(onClick = onFlush) { Text("Flush") }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedButton(onClick = onHeartbeat) { Text("Heartbeat now") }
            OutlinedButton(onClick = onReprovision) { Text("Re-provision") }
        }
    }
}

/**
 * Recent captures with delivery status. Raw text is visible on purpose: when
 * the parser breaks, this is where you read what actually arrived.
 */
@Composable
private fun LogScreen(captures: List<Capture>) {
    if (captures.isEmpty()) {
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            Text("Nothing captured yet.", style = MaterialTheme.typography.bodyMedium)
        }
        return
    }

    LazyColumn(Modifier.fillMaxSize().padding(horizontal = 12.dp)) {
        items(captures, key = { it.localId }) { capture ->
            Column(Modifier.fillMaxWidth().padding(vertical = 10.dp)) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(
                        if (capture.sent) "sent" else "queued",
                        style = MaterialTheme.typography.labelSmall,
                        color = if (capture.sent) Color(0xFF2E9E5B) else Color(0xFFD08B1E),
                    )
                    Text(capture.source, style = MaterialTheme.typography.labelSmall)
                    Text(clock(capture.capturedAt), style = MaterialTheme.typography.labelSmall)
                    if (capture.attempts > 0) {
                        Text("${capture.attempts} attempts", style = MaterialTheme.typography.labelSmall)
                    }
                }
                Text(
                    capture.raw,
                    style = MaterialTheme.typography.bodySmall,
                    fontFamily = FontFamily.Monospace,
                )
                capture.lastError?.let {
                    Text(it, style = MaterialTheme.typography.labelSmall, color = Color(0xFFC0392B))
                }
            }
            HorizontalDivider()
        }
    }
}

/** Permission checklist with a live tick or cross against each. */
@Composable
private fun SetupScreen(
    state: UiState,
    onOpenNotificationSettings: () -> Unit,
    onRequestSms: () -> Unit,
    onOpenBatterySettings: () -> Unit,
    onScan: () -> Unit,
) {
    Column(
        Modifier.fillMaxSize().padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        CheckRow(
            label = "Notification access",
            granted = state.hasNotificationAccess,
            detail = "The primary capture path. Without it nothing is captured at all.",
            action = "Open settings",
            onAction = onOpenNotificationSettings,
        )
        CheckRow(
            label = "SMS permission",
            granted = state.hasSmsPermission,
            detail = "The second path. Catches what notifications miss.",
            action = "Grant",
            onAction = onRequestSms,
        )
        CheckRow(
            label = "Battery optimisation",
            granted = null,
            detail = "Exempt this app, then check the OEM's own autostart settings — on Xiaomi, Oppo, Vivo and Samsung those override standard Android and are the usual cause of a silently dead notifier.",
            action = "Open settings",
            onAction = onOpenBatterySettings,
        )
        CheckRow(
            label = "Provisioning",
            granted = state.provisioned && !state.revoked,
            detail = state.serverUrl ?: "Not provisioned",
            action = "Scan code",
            onAction = onScan,
        )
    }
}

@Composable
private fun CheckRow(
    label: String,
    granted: Boolean?,
    detail: String,
    action: String,
    onAction: () -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                when (granted) {
                    true -> "✓  "
                    false -> "✗  "
                    null -> "•  "
                },
                color = when (granted) {
                    true -> Color(0xFF2E9E5B)
                    false -> Color(0xFFC0392B)
                    null -> Color(0xFF888888)
                },
            )
            Text(label, fontWeight = FontWeight.Medium)
        }
        Text(detail, style = MaterialTheme.typography.bodySmall)
        OutlinedButton(onClick = onAction) { Text(action) }
    }
    HorizontalDivider()
}

@Composable
private fun StatRow(label: String, value: String) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        Text(label, style = MaterialTheme.typography.bodyMedium)
        Text(value, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium)
    }
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
