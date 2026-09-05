package com.jomma.notifier.ui

import android.Manifest
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.compose.material3.SnackbarHostState
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue

/**
 * Three destinations, deliberately plain. Nobody uses this app — they check it.
 * The status card is the whole product.
 */
class MainActivity : ComponentActivity() {

    private val viewModel: MainViewModel by viewModels()

    private val permissionLauncher =
        registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
            viewModel.refresh()
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        // Material You wants the app drawing behind the system bars.
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)

        handlePairingLink(intent)

        setContent {
            JommaTheme {
                val state by viewModel.state.collectAsState()
                val captures by viewModel.recentCaptures.collectAsState()
                val snackbar = remember { SnackbarHostState() }
                var scanning by remember { mutableStateOf(false) }

                LaunchedEffect(state.message) {
                    state.message?.let {
                        snackbar.showSnackbar(it)
                        viewModel.dismissMessage()
                    }
                }

                JommaSurface {
                    JommaScreens(
                        state = state,
                        captures = captures,
                        snackbarHost = snackbar,
                        onScan = { scanning = true },
                        onOpenNotificationSettings = ::openNotificationAccessSettings,
                        onRequestSms = ::requestSmsPermission,
                        onOpenBatterySettings = ::openBatterySettings,
                        onFlush = viewModel::flushNow,
                        onHeartbeat = viewModel::heartbeatNow,
                        onTestCapture = viewModel::sendTestCapture,
                        onReprovision = viewModel::reprovision,
                        onCaptureChange = viewModel::setCapture,
                    )
                }

                /*
                 * Drawn over the app rather than launched as its own Activity.
                 *
                 * The old library brought an Activity with it, pinned to
                 * landscape in its own manifest — rotating the phone to scan a
                 * code was the most obviously broken thing in the app, and no
                 * runtime option could override it. Composing it here means it
                 * follows the user's rotation lock like every other screen.
                 */
                if (scanning) {
                    ScannerScreen(
                        onResult = { scanned ->
                            scanning = false
                            viewModel.provision(scanned)
                        },
                        onDismiss = { scanning = false },
                    )
                }

                BackHandler(enabled = scanning) { scanning = false }
            }
        }
    }

    /**
     * The activity is `singleTask`, so a link arriving while it is already open
     * is delivered here rather than through `onCreate`. Without this, scanning
     * the QR with the app in the background would bring it to the front and do
     * nothing else — which looks exactly like the feature not working.
     */
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handlePairingLink(intent)
    }

    /**
     * A provisioning link opened from outside the app.
     *
     * Some other QR scanner read `https://<host>/pair/<code>` and Android
     * routed it here, because the domain names this app's signing certificate
     * in its assetlinks.json. From this point on it is the same path as the
     * app's own scanner — `provision` takes the URL either way and does the
     * validating.
     *
     * The intent's data is cleared afterwards so a configuration change does
     * not replay it. Redeeming twice would fail, having burned the code, and
     * report a failure for a pairing that worked.
     */
    private fun handlePairingLink(intent: Intent?) {
        val link = intent?.takeIf { it.action == Intent.ACTION_VIEW }?.dataString ?: return
        intent.data = null
        viewModel.provision(link)
    }

    override fun onResume() {
        super.onResume()
        // Permission self-check on every launch, per docs/android.md.
        viewModel.refresh()
    }

    /** There is no runtime permission for notification access — only settings. */
    private fun openNotificationAccessSettings() {
        startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS))
    }

    private fun requestSmsPermission() {
        val permissions = mutableListOf(Manifest.permission.RECEIVE_SMS, Manifest.permission.READ_SMS)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            permissions += Manifest.permission.POST_NOTIFICATIONS
        }
        permissionLauncher.launch(permissions.toTypedArray())
    }

    /**
     * Battery optimisation is the most common cause of a silently dead notifier,
     * and on Xiaomi, Oppo, Vivo and Samsung the OEM's own autostart settings
     * override standard Android behaviour on top of this.
     */
    private fun openBatterySettings() {
        startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))
    }
}
