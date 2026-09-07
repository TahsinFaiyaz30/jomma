package com.jomma.notifier.ui

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.FilterAlt
import androidx.compose.material.icons.outlined.Schedule
import androidx.compose.material.icons.outlined.SimCard
import androidx.compose.material.icons.outlined.Sms
import androidx.compose.material.icons.outlined.Warning
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.ListItem
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import com.jomma.notifier.data.Attribution
import com.jomma.notifier.data.Pairing
import com.jomma.notifier.data.SimCard
import com.jomma.notifier.net.CaptureSettings

/**
 * One wallet, on its own screen.
 *
 * This used to be a card in a "Numbers" list in Settings, which was wrong in
 * two directions at once. Settings is for what is true of *this phone* --
 * permissions, staying alive, updates -- and a bKash account's capture rules
 * are true of the account rather than of the handset holding it. And the list
 * shadowed the wallet list on Status: the same account in two places, with
 * different detail in each and nothing saying which one to believe.
 *
 * So Manage on a wallet opens this, and there is exactly one place where a
 * wallet's settings live. Reached and left through [JommaScreens], which owns
 * the back arrow -- this composable renders a wallet and nothing else.
 */
@Composable
fun WalletScreen(
    pairing: Pairing,
    saving: Boolean,
    needsSim: Boolean,
    sims: List<SimCard>,
    onCaptureChange: (CaptureSettings) -> Unit,
    onSendingChange: (Boolean) -> Unit,
    onRemove: () -> Unit,
) {
    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(bottom = 24.dp),
    ) {
        SectionHeader(pairing.provider?.replaceFirstChar { it.uppercase() } ?: "Wallet")
        WalletBody(
            pairing = pairing,
            saving = saving,
            needsSim = needsSim,
            sims = sims,
            onCaptureChange = onCaptureChange,
            onSendingChange = onSendingChange,
            onRemove = onRemove,
        )
        Spacer(Modifier.height(8.dp))
    }
}

@Composable
private fun WalletBody(
    pairing: Pairing,
    saving: Boolean,
    needsSim: Boolean,
    sims: List<SimCard>,
    onCaptureChange: (CaptureSettings) -> Unit,
    onSendingChange: (Boolean) -> Unit,
    onRemove: () -> Unit,
) {
    SettingsCard {
        ListItem(
            leadingContent = {
                Icon(
                    if (pairing.live) Icons.Outlined.CheckCircle else Icons.Outlined.Schedule,
                    contentDescription = null,
                    tint = if (pairing.live) MaterialTheme.colorScheme.primary
                    else MaterialTheme.colorScheme.error,
                )
            },
            headlineContent = { Text(pairing.label) },
            supportingContent = {
                Text(
                    when {
                        pairing.revoked ->
                            "Revoked from the dashboard. Remove it and scan a new code."
                        pairing.awaitingApproval ->
                            "Scanned. Approve this phone on the dashboard to start capturing."
                        !pairing.sendingEnabled -> "Paused on this phone. The dashboard is told."
                        // Paired to the business, waiting for a SIM to be
                        // chosen on the dashboard. It heartbeats — that is how
                        // the SIM list gets there — and captures nothing.
                        pairing.accountMsisdn == null ->
                            "Paired. Choose which SIM this phone is paid on, in the dashboard."
                        // Not the provider again -- the screen is already
                        // titled with it, and repeating it here left the only
                        // healthy state saying nothing about being healthy.
                        else -> "Working. Messages for this number are being captured."
                    },
                )
            },
            trailingContent = {
                TextButton(onClick = onRemove) { Text("Remove") }
            },
            colors = ListItemDefaults.colors(containerColor = Color.Transparent),
        )

        HorizontalDivider()
        SwitchRow(
            title = "Report for this number",
            subtitle = if (pairing.sendingEnabled) {
                "Messages for it are captured and sent."
            } else {
                "Paused. Nothing is captured, and nothing is held back to send later."
            },
            checked = pairing.sendingEnabled,
            // Deliberately available even when the pairing is not live. Somebody
            // whose approval is still pending should be able to decide in
            // advance whether this phone will report at all.
            enabled = !saving,
            onChange = onSendingChange,
            icon = Icons.Outlined.Sms,
        )

        /*
         * Which SIM this number arrives on, when the phone knows.
         *
         * Shown rather than asked. The binding is made when the number is
         * chosen, and this is how somebody checks the phone agrees with what
         * the dashboard thinks — the case that used to fail silently.
         */
        val boundSim = sims.firstOrNull { it.subscriptionId == pairing.subscriptionId }
        if (boundSim != null) {
            HorizontalDivider()
            ListItem(
                leadingContent = { Icon(Icons.Outlined.SimCard, contentDescription = null) },
                headlineContent = { Text("SIM ${boundSim.slotIndex + 1} · ${boundSim.carrierName}") },
                supportingContent = {
                    Text(
                        if (boundSim.msisdn == pairing.accountMsisdn) {
                            "Messages on this SIM belong to this number."
                        } else {
                            // The failsafe, surfaced. Captures are already being
                            // refused; saying why beats silence.
                            "This SIM now reports ${boundSim.msisdn ?: "no number"}, not " +
                                "${pairing.accountMsisdn}. Captures are refused until it matches."
                        },
                    )
                },
                colors = ListItemDefaults.colors(containerColor = Color.Transparent),
            )
        }

        if (needsSim) {
            HorizontalDivider()
            ListItem(
                leadingContent = { Icon(Icons.Outlined.Warning, contentDescription = null) },
                headlineContent = { Text("Which SIM is this?") },
                supportingContent = {
                    Text(
                        "Two numbers here use the same provider, so an SMS cannot be told " +
                            "apart by its sender alone.",
                    )
                },
                colors = ListItemDefaults.colors(containerColor = Color.Transparent),
            )
        }

        // Only a live number's settings can be written: the server refuses the
        // call otherwise, and a switch that silently fails is worse than one
        // that is visibly unavailable.
        val editable = pairing.live && !saving

        HorizontalDivider()
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
            checked = pairing.capture.cashIn,
            enabled = editable,
            onChange = { onCaptureChange(pairing.capture.copy(cashIn = it)) },
        )
        HorizontalDivider()
        SwitchRow(
            title = "Money you sent",
            subtitle = "A ledger of outgoing transfers. Never matched to an order.",
            checked = pairing.capture.outgoing,
            enabled = editable,
            onChange = { onCaptureChange(pairing.capture.copy(outgoing = it)) },
        )
        HorizontalDivider()
        SwitchRow(
            title = "Everything else",
            subtitle = "Promotions and balance notices. Usually noise.",
            checked = pairing.capture.other,
            enabled = editable,
            onChange = { onCaptureChange(pairing.capture.copy(other = it)) },
        )
    }
}
