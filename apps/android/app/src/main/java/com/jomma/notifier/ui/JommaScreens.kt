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
import com.jomma.notifier.data.BusinessGroup
import androidx.compose.material.icons.automirrored.outlined.ArrowForward
import androidx.compose.material.icons.outlined.Tune
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.material3.AlertDialog
import androidx.compose.material.icons.outlined.LinkOff
import androidx.compose.runtime.setValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.mutableStateOf
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.DropdownMenu
import androidx.compose.material.icons.outlined.Storefront
import com.jomma.notifier.data.Attribution
import androidx.compose.material3.IconButton
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
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
import androidx.compose.material.icons.outlined.Schedule
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
import androidx.compose.material3.TextButton
import androidx.compose.material.icons.outlined.SimCard
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
    /**
     * The merchant whose own screen is open, or null for the tabs.
     *
     * Held as a key rather than the group so it is re-read from state on every
     * recomposition: a business disconnected from anywhere else takes its
     * screen with it rather than leaving one that edits something gone.
     */
    managingBusinessKey: String?,
    onManageBusiness: (String) -> Unit,
    onCloseBusiness: () -> Unit,
    /**
     * The wallet whose own screen is open, or null.
     *
     * One level below a business. Held as a device id so the pairing is re-read
     * from state on every recomposition — a wallet removed elsewhere closes the
     * screen rather than leaving a stale copy of it on display.
     */
    managingDeviceId: String?,
    onManage: (String) -> Unit,
    onCloseManage: () -> Unit,
    onSwitchBusiness: (String) -> Unit,
    onBusinessEnabledChange: (String, Boolean) -> Unit,
    onDisconnectBusiness: (String) -> Unit,
    onDisconnectEverything: () -> Unit,
    onScan: () -> Unit,
    onAddAccount: (String, String) -> Unit,
    onPickSim: (Int) -> Unit,
    onCancelAdd: () -> Unit,
    onOpenNotificationSettings: () -> Unit,
    onRequestSms: () -> Unit,
    onRequestPhone: () -> Unit,
    onRequestBatteryExemption: () -> Unit,
    onOpenAutoStart: () -> Unit,
    onIntervalChange: (UpdateInterval) -> Unit,
    onAutoDownloadChange: (Boolean) -> Unit,
    onUnmeteredOnlyChange: (Boolean) -> Unit,
    onCheckForUpdates: () -> Unit,
    onDownloadUpdate: () -> Unit,
    onInstallUpdate: () -> Unit,
    onDeleteDownload: () -> Unit,
    onOpenGitHub: () -> Unit,
    onFlush: () -> Unit,
    onHeartbeat: () -> Unit,
    onTestCapture: () -> Unit,
    onCaptureChange: (String, CaptureSettings) -> Unit,
    onSendingChange: (String, Boolean) -> Unit,
    onRemovePairing: (String) -> Unit,
) {
    // Re-read rather than captured: a wallet that disappears takes its screen
    // with it instead of leaving one that edits something no longer there.
    val managing = managingDeviceId?.let { id -> state.pairings.firstOrNull { it.deviceId == id } }
    val business = managingBusinessKey?.let { key -> state.businesses.firstOrNull { it.key == key } }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Text(
                        when {
                            managing != null ->
                                managing.provider?.replaceFirstChar { it.uppercase() } ?: "Wallet"
                            business != null -> business.name
                            destination == 1 -> "Log"
                            destination == 2 -> "Settings"
                            else -> "Jomma Notifier"
                        },
                    )
                },
                navigationIcon = {
                    // A wallet closes back to its business; a business closes
                    // back to the tabs. One level at a time, which is what the
                    // system gesture does too.
                    if (managing != null || business != null) {
                        IconButton(onClick = if (managing != null) onCloseManage else onCloseBusiness) {
                            Icon(
                                Icons.AutoMirrored.Outlined.ArrowBack,
                                contentDescription = "Back",
                            )
                        }
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.surface,
                    titleContentColor = MaterialTheme.colorScheme.onSurface,
                ),
            )
        },
        bottomBar = {
            // Hidden below the top level. The tabs are the top level and both a
            // business and a wallet sit under it; showing the bar invites
            // leaving sideways from a screen that has a back arrow.
            if (managing != null || business != null) return@Scaffold
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
            if (managing != null) {
                WalletScreen(
                    pairing = managing,
                    saving = state.captureSavingFor == managing.deviceId,
                    needsSim = Attribution.needsSubscriptionId(state.pairings, managing),
                    sims = state.sims,
                    onCaptureChange = { onCaptureChange(managing.deviceId, it) },
                    onSendingChange = { onSendingChange(managing.deviceId, it) },
                    onRemove = {
                        onRemovePairing(managing.deviceId)
                        // Nothing left to manage once it is gone.
                        onCloseManage()
                    },
                )
                return@Box
            }

            if (business != null) {
                BusinessScreen(
                    business = business,
                    state = state,
                    onEnabledChange = onBusinessEnabledChange,
                    onDisconnect = { key ->
                        onDisconnectBusiness(key)
                        // Nothing left to manage once it is gone.
                        onCloseBusiness()
                    },
                    onAddAccount = onAddAccount,
                    onPickSim = onPickSim,
                    onCancelAdd = onCancelAdd,
                    onManageWallet = onManage,
                    onScan = onScan,
                )
                return@Box
            }

            when (destination) {
                0 -> StatusScreen(
                    state = state,
                    onScan = onScan,
                    onFlush = onFlush,
                    onHeartbeat = onHeartbeat,
                    onTestCapture = onTestCapture,
                    onAddAccount = onAddAccount,
                    onPickSim = onPickSim,
                    onCancelAdd = onCancelAdd,
                    onManage = onManage,
                    onSwitchBusiness = onSwitchBusiness,
                    onManageBusiness = onManageBusiness,
                )
                1 -> LogScreen(captures)
                else -> SettingsScreen(
                    state = state,
                    onOpenNotificationSettings = onOpenNotificationSettings,
                    onRequestSms = onRequestSms,
                    onRequestPhone = onRequestPhone,
                    onRequestBatteryExemption = onRequestBatteryExemption,
                    onOpenAutoStart = onOpenAutoStart,
                    onScan = onScan,
                    onCaptureChange = onCaptureChange,
                    onSendingChange = onSendingChange,
                    onRemovePairing = onRemovePairing,
                    onBusinessEnabledChange = onBusinessEnabledChange,
                    onManageBusiness = onManageBusiness,
                    onDisconnectEverything = onDisconnectEverything,
                    onIntervalChange = onIntervalChange,
                    onAutoDownloadChange = onAutoDownloadChange,
                    onUnmeteredOnlyChange = onUnmeteredOnlyChange,
                    onCheckForUpdates = onCheckForUpdates,
                    onDownloadUpdate = onDownloadUpdate,
                    onInstallUpdate = onInstallUpdate,
                    onDeleteDownload = onDeleteDownload,
                    onOpenGitHub = onOpenGitHub,
                )
            }
        }
    }
}

/** One glance answers "is it working?". The status card is the whole product. */
/**
 * The wallets this phone is paid on, and how to add another.
 *
 * Here rather than buried in Settings because it is the thing somebody opens
 * the app to check: which numbers are being watched, and are they working.
 * Adding one is two decisions — which wallet, then which SIM — asked in that
 * order because the answer to the second depends on the first: a number already
 * used for bKash is still a perfectly good Nagad number.
 */
@Composable
private fun MfsSection(
    state: UiState,
    business: BusinessGroup,
    onAddAccount: (String, String) -> Unit,
    onPickSim: (Int) -> Unit,
    onCancelAdd: () -> Unit,
    onManage: (String) -> Unit,
) {
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(vertical = 4.dp)) {
            Text(
                "Wallets",
                style = MaterialTheme.typography.titleSmall,
                modifier = Modifier.padding(start = 16.dp, top = 12.dp, bottom = 4.dp),
            )

            // This merchant's, and only this merchant's. A phone helping two
            // shops used to list both shops' numbers in one undifferentiated
            // column, with each Manage button leading somewhere the row did not
            // say it would.
            val wallets = business.wallets

            if (wallets.isEmpty()) {
                Text(
                    "None yet. Add one below and pick the SIM it is paid on.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
                )
            }

            for (pairing in wallets) {
                HorizontalDivider()
                ListItem(
                    leadingContent = { Icon(Icons.Outlined.SimCard, contentDescription = null) },
                    headlineContent = {
                        Text(pairing.provider?.replaceFirstChar { it.uppercase() } ?: "Wallet")
                    },
                    supportingContent = {
                        Text(
                            when {
                                pairing.revoked -> "Revoked from the dashboard."
                                pairing.awaitingApproval -> "Waiting for approval."
                                !pairing.sendingEnabled -> "${pairing.label} · paused"
                                else -> pairing.label
                            },
                        )
                    },
                    // Everything about one wallet lives behind its own button:
                    // what it keeps, whether it reports, which SIM it is on.
                    trailingContent = {
                        TextButton(onClick = { onManage(pairing.deviceId) }) { Text("Manage") }
                    },
                    colors = ListItemDefaults.colors(containerColor = Color.Transparent),
                )
            }

            HorizontalDivider()

            if (state.addingProvider == null) {
                Row(
                    Modifier.fillMaxWidth().padding(16.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    OutlinedButton(
                        onClick = { onAddAccount(business.key, "bkash") },
                        enabled = !state.addBusy,
                        modifier = Modifier.weight(1f),
                    ) { Text("Add bKash") }
                    /*
                     * Offered and refused rather than hidden. Nagad accounts can
                     * be added — the whole ledger is provider-agnostic — but
                     * `lib/parsers/nagad.ts` is a deliberate stub, so nothing
                     * would ever be matched from one. Saying that beats a button
                     * that quietly does nothing useful.
                     */
                    OutlinedButton(
                        onClick = { },
                        enabled = false,
                        modifier = Modifier.weight(1f),
                    ) { Text("Nagad — soon") }
                }
            } else {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(
                        "Which SIM is your ${state.addingProvider} on?",
                        style = MaterialTheme.typography.bodyMedium,
                    )

                    if (state.addBusy && state.addableSims.isEmpty()) {
                        Text(
                            "Reading the SIMs…",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }

                    for (sim in state.addableSims) {
                        val usable = sim.blockedReason == null && sim.msisdn != null
                        ListItem(
                            leadingContent = {
                                Icon(Icons.Outlined.SimCard, contentDescription = null)
                            },
                            headlineContent = {
                                Text("SIM ${sim.slotIndex + 1} · ${sim.carrierName}")
                            },
                            // A SIM that cannot be used is shown with the reason
                            // rather than hidden: somebody comparing this list
                            // against the tray in their hand needs to know why.
                            supportingContent = {
                                Text(sim.blockedReason ?: sim.msisdn ?: "No number on this SIM")
                            },
                            trailingContent = {
                                TextButton(
                                    onClick = { onPickSim(sim.subscriptionId) },
                                    enabled = usable && !state.addBusy,
                                ) { Text("Use") }
                            },
                            colors = ListItemDefaults.colors(containerColor = Color.Transparent),
                        )
                    }

                    TextButton(onClick = onCancelAdd) { Text("Cancel") }
                }
            }
        }
    }
}

@Composable
private fun StatusScreen(
    state: UiState,
    onScan: () -> Unit,
    onFlush: () -> Unit,
    onHeartbeat: () -> Unit,
    onTestCapture: () -> Unit,
    onAddAccount: (String, String) -> Unit,
    onPickSim: (Int) -> Unit,
    onCancelAdd: () -> Unit,
    onManage: (String) -> Unit,
    onSwitchBusiness: (String) -> Unit,
    onManageBusiness: (String) -> Unit,
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
        /*
         * Which shop you are looking at, above everything it says.
         *
         * Only when there is more than one. A single-business phone should not
         * be made to answer a question it does not have, and this is the screen
         * somebody opens to check one thing.
         */
        if (state.provisioned) {
            BusinessCard(
                state = state,
                onSwitch = onSwitchBusiness,
                onManageBusiness = onManageBusiness,
            )
        }

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
                                "Watching ${state.livePairings.first().label}"
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
             * "Scan a code", not "Add a number".
             *
             * Scanning does not add a number any more — it connects this phone
             * to a business. Which number it watches is chosen afterwards, in
             * the dashboard, from the SIMs this phone reports. Labelling the
             * scanner "Add a number" promised something the QR behind it cannot
             * do, and opened a camera at somebody expecting a form.
             *
             * Removing a number specifically lives on Settings, beside the
             * number it would remove.
             */
            OutlinedButton(onClick = onScan, modifier = Modifier.weight(1f)) { Text("Scan a code") }
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

/**
 * Which merchant the screens are showing, and the way into it.
 *
 * Deliberately thin. It answers one question — which shop is this — and then
 * hands over: everything *about* that shop lives behind Manage, one level down,
 * because the status screen is what somebody opens to check whether money is
 * arriving and should not become a settings page.
 *
 * The distinction this card works hardest at is between *showing* and
 * *running*. Every enabled business is watched at the same time whatever is
 * selected here: the phone holds a credential each and beats them all, so
 * switching changes the view and nothing else. A shop is never left unwatched
 * because somebody looked at another one, and the card says so out loud rather
 * than leaving it to be inferred from a control that looks like a power button.
 */
@Composable
private fun BusinessCard(
    state: UiState,
    onSwitch: (String) -> Unit,
    onManageBusiness: (String) -> Unit,
) {
    var open by remember { mutableStateOf(false) }
    val active = state.activeBusiness ?: return
    val others = state.businesses.size - 1

    Card(Modifier.fillMaxWidth()) {
        ListItem(
            leadingContent = { Icon(Icons.Outlined.Storefront, contentDescription = null) },
            overlineContent = { Text("Showing") },
            headlineContent = { Text(active.name, fontWeight = FontWeight.SemiBold) },
            supportingContent = {
                Text(
                    when {
                        !active.enabled -> "Paused — nothing is captured for this one"
                        others == 0 -> "The only business this phone helps"
                        others == 1 -> "1 other also being watched"
                        else -> "$others others also being watched"
                    },
                )
            },
            trailingContent = {
                if (state.businesses.size > 1) {
                    Box {
                        TextButton(onClick = { open = true }) { Text("Switch") }
                        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
                            for (business in state.businesses) {
                                DropdownMenuItem(
                                    text = {
                                        // Paused ones stay listed: hiding one you
                                        // switched off is how you forget you did.
                                        Text(
                                            if (business.enabled) business.name
                                            else business.name + " · paused",
                                        )
                                    },
                                    leadingIcon = {
                                        if (business.key == active.key) {
                                            Icon(
                                                Icons.Filled.CheckCircle,
                                                contentDescription = null,
                                            )
                                        }
                                    },
                                    onClick = {
                                        open = false
                                        onSwitch(business.key)
                                    },
                                )
                            }
                        }
                    }
                }
            },
            colors = ListItemDefaults.colors(containerColor = Color.Transparent),
        )

        HorizontalDivider()
        ListItem(
            leadingContent = { Icon(Icons.Outlined.Tune, contentDescription = null) },
            headlineContent = { Text("Manage") },
            supportingContent = {
                Text(
                    if (active.wallets.isEmpty()) {
                        "Its numbers, reporting and connection."
                    } else if (active.wallets.size == 1) {
                        "1 number, reporting and connection."
                    } else {
                        active.wallets.size.toString() + " numbers, reporting and connection."
                    },
                )
            },
            trailingContent = {
                Icon(Icons.AutoMirrored.Outlined.ArrowForward, contentDescription = null)
            },
            modifier = Modifier.clickable { onManageBusiness(active.key) },
            colors = ListItemDefaults.colors(containerColor = Color.Transparent),
        )
    }
}

/**
 * One merchant, and everything this phone does for them.
 *
 * The middle of three levels: the status screen says which shop, this says what
 * the phone is doing for it, and a wallet's own screen says what it keeps for
 * one number. Splitting them that way is what stopped the status screen turning
 * into a settings page, and stopped a wallet's rules being edited from a list
 * that never said which shop the row belonged to.
 *
 * Reached and left through [JommaScreens], which owns the back arrow. The
 * business is re-read from state on every recomposition rather than captured,
 * so one disconnected from elsewhere takes its screen with it instead of
 * leaving a page that edits something no longer there.
 */
@Composable
private fun BusinessScreen(
    business: BusinessGroup,
    state: UiState,
    onEnabledChange: (String, Boolean) -> Unit,
    onDisconnect: (String) -> Unit,
    onAddAccount: (String, String) -> Unit,
    onPickSim: (Int) -> Unit,
    onCancelAdd: () -> Unit,
    onManageWallet: (String) -> Unit,
    onScan: () -> Unit,
) {
    var confirming by remember { mutableStateOf(false) }

    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        /*
         * What the server thinks of this phone, said before anything else.
         *
         * A phone that has scanned and not been approved captures nothing, and
         * the screen it was most likely to be checked from said only that
         * reporting was on — technically true, useless, and the reason somebody
         * would sit watching a dashboard that never filled. Worse for a phone
         * that was turned away: "declined" and "not approved yet" look identical
         * from here and want opposite reactions, one being wait and the other
         * being ask again with a new code.
         *
         * So the state is named, and the thing to do about it is next to it.
         */
        if (business.awaitingApproval || business.revoked) {
            Card(Modifier.fillMaxWidth()) {
                ListItem(
                    leadingContent = {
                        Icon(
                            if (business.revoked) Icons.Filled.Error else Icons.Outlined.Schedule,
                            contentDescription = null,
                            tint = if (business.revoked) MaterialTheme.colorScheme.error
                            else MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    },
                    headlineContent = {
                        Text(
                            if (business.revoked) "Declined" else "Waiting for approval",
                            fontWeight = FontWeight.SemiBold,
                        )
                    },
                    supportingContent = {
                        Text(
                            if (business.revoked) {
                                // Named as a decision somebody made, not as a
                                // fault: this phone is working, it was simply
                                // not the one they meant to let in.
                                "This phone was turned away on " + business.name + "'s Jomma " +
                                    "dashboard, so nothing is being captured for it. Ask them " +
                                    "for a new code and scan it below."
                            } else {
                                // Where, precisely. "Approve it on the dashboard"
                                // is no help to somebody who has never seen one.
                                "This phone has scanned " + business.name + "'s code and will " +
                                    "capture nothing until somebody approves it. On their " +
                                    "Jomma dashboard: Accounts, then Devices, then Approve."
                            },
                        )
                    },
                    colors = ListItemDefaults.colors(containerColor = Color.Transparent),
                )

                HorizontalDivider()
                ListItem(
                    leadingContent = {
                        Icon(Icons.Outlined.QrCodeScanner, contentDescription = null)
                    },
                    headlineContent = { Text("Scan a new code") },
                    supportingContent = {
                        Text(
                            // A pairing code is single use and expires, so
                            // "try again" always means a fresh one — and after
                            // a decline it is the only way back.
                            "Codes are used once and expire. Ask for a fresh one and scan it " +
                                "to connect this phone again.",
                        )
                    },
                    modifier = Modifier.clickable(onClick = onScan),
                    colors = ListItemDefaults.colors(containerColor = Color.Transparent),
                )
            }
        }

        Card(Modifier.fillMaxWidth()) {
            ListItem(
                leadingContent = { Icon(Icons.Outlined.Sms, contentDescription = null) },
                headlineContent = { Text("Report for this business") },
                supportingContent = {
                    Text(
                        if (business.enabled) {
                            "Messages for its numbers are captured and sent."
                        } else {
                            // The half people get wrong: off means dropped, not
                            // queued to arrive in a burst when it goes back on.
                            "Paused. Nothing is captured for it, and nothing is held."
                        },
                    )
                },
                trailingContent = {
                    Switch(
                        checked = business.enabled,
                        onCheckedChange = { onEnabledChange(business.key, it) },
                        // Named: a bare switch announces only "on", and this
                        // screen can be showing any one of several merchants.
                        modifier = Modifier.semantics {
                            contentDescription = "Reporting for " + business.name
                        },
                    )
                },
                colors = ListItemDefaults.colors(containerColor = Color.Transparent),
            )
        }

        MfsSection(
            state = state,
            business = business,
            onAddAccount = onAddAccount,
            onPickSim = onPickSim,
            onCancelAdd = onCancelAdd,
            onManage = onManageWallet,
        )

        Card(Modifier.fillMaxWidth()) {
            ListItem(
                leadingContent = { Icon(Icons.Outlined.LinkOff, contentDescription = null) },
                headlineContent = { Text("Disconnect this business") },
                supportingContent = {
                    Text("Hands its credentials back and forgets all of its numbers.")
                },
                modifier = Modifier.clickable { confirming = true },
                colors = ListItemDefaults.colors(containerColor = Color.Transparent),
            )
        }
    }

    if (confirming) {
        AlertDialog(
            onDismissRequest = { confirming = false },
            title = { Text("Disconnect from " + business.name + "?") },
            text = {
                Text(
                    "This phone stops helping it and hands its credentials back" +
                        // Counted properly. "forgets all 1 of its numbers" is the
                        // kind of sentence that makes somebody wonder whether the
                        // rest of the warning can be trusted either.
                        when (business.wallets.size) {
                            0 -> "."
                            1 -> ", forgetting its number."
                            else -> ", forgetting all " + business.wallets.size + " of its numbers."
                        } +
                        " That dashboard will show this phone as revoked, and anything not " +
                        "yet sent is lost.\n\n" +
                        "To stop reporting for a while without giving anything up, use the " +
                        "switch above instead.",
                )
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        confirming = false
                        onDisconnect(business.key)
                    },
                ) { Text("Disconnect") }
            },
            dismissButton = {
                TextButton(onClick = { confirming = false }) { Text("Cancel") }
            },
        )
    }
}
