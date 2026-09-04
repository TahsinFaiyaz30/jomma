package com.jomma.notifier.ui

import android.Manifest
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.compose.material3.SnackbarHostState
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import com.journeyapps.barcodescanner.ScanContract
import com.journeyapps.barcodescanner.ScanOptions

/**
 * Three destinations, deliberately plain. Nobody uses this app — they check it.
 * The status card is the whole product.
 */
class MainActivity : ComponentActivity() {

    private val viewModel: MainViewModel by viewModels()

    private val scanLauncher = registerForActivityResult(ScanContract()) { result ->
        result.contents?.let(viewModel::provision)
    }

    private val permissionLauncher =
        registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
            viewModel.refresh()
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        // Material You wants the app drawing behind the system bars.
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)

        setContent {
            JommaTheme {
                val state by viewModel.state.collectAsState()
                val captures by viewModel.recentCaptures.collectAsState()
                val snackbar = remember { SnackbarHostState() }

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
                        onScan = ::launchScanner,
                        onOpenNotificationSettings = ::openNotificationAccessSettings,
                        onRequestSms = ::requestSmsPermission,
                        onOpenBatterySettings = ::openBatterySettings,
                        onFlush = viewModel::flushNow,
                        onHeartbeat = viewModel::heartbeatNow,
                        onTestCapture = viewModel::sendTestCapture,
                        onReprovision = viewModel::reprovision,
                    )
                }
            }
        }
    }

    override fun onResume() {
        super.onResume()
        // Permission self-check on every launch, per docs/android.md.
        viewModel.refresh()
    }

    private fun launchScanner() {
        scanLauncher.launch(
            ScanOptions()
                .setPrompt("Scan the provisioning code from the Jomma dashboard")
                .setBeepEnabled(false)
                .setOrientationLocked(false),
        )
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
