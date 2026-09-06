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
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import android.net.Uri
import com.jomma.notifier.service.KeepAlive
import com.jomma.notifier.update.UpdateCheckWorker
import com.jomma.notifier.update.Updater

/**
 * Three destinations, deliberately plain. Nobody uses this app — they check it.
 * The status card is the whole product.
 */
class MainActivity : ComponentActivity() {

    private val viewModel: MainViewModel by viewModels()

    /**
     * Which tab is showing.
     *
     * Held here rather than inside the composition because an intent can decide
     * it. This activity is `singleTask`, so tapping the update notification
     * while the app is already open arrives at `onNewIntent` — by which point a
     * composable's own `remember` has long since made up its mind and there is
     * no way to change it from outside.
     */
    private val destination = mutableIntStateOf(HOME_TAB)

    private val permissionLauncher =
        registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
            viewModel.refresh()
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        // Material You wants the app drawing behind the system bars.
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)

        handlePairingLink(intent)

        /*
         * If a previous version installed itself, this process is the proof —
         * so the APK that got us here can go. See MainViewModel.
         */
        viewModel.purgeStaleDownloads()

        /*
         * A check on launch, honouring the configured interval — `isCheckDue`
         * decides, so "once a week" does not become "every launch" just because
         * this runs here. Silent, because a phone with no signal should not
         * greet its owner with a failure they did not ask for.
         *
         * Skipped when the notification is what opened us, since that path does
         * its own, louder check.
         */
        if (!handleUpdateNotification(intent) && Updater.isCheckDue(this)) {
            viewModel.checkForUpdates(silent = true)
        }
        UpdateCheckWorker.schedule(this)

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
                        destination = destination.intValue,
                        onDestinationChange = { destination.intValue = it },
                        onScan = { scanning = true },
                        onOpenNotificationSettings = ::openNotificationAccessSettings,
                        onRequestSms = ::requestSmsPermission,
                        onRequestBatteryExemption = ::requestBatteryExemption,
                        onOpenAutoStart = ::openAutoStartSettings,
                        onIntervalChange = viewModel::setUpdateInterval,
                        onAutoDownloadChange = viewModel::setAutoDownloadUpdates,
                        onUnmeteredOnlyChange = viewModel::setUpdatesOnUnmeteredOnly,
                        onCheckForUpdates = { viewModel.checkForUpdates() },
                        onInstallUpdate = ::installUpdate,
                        onOpenGitHub = ::openGitHub,
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
        handleUpdateNotification(intent)
    }

    /**
     * Opening the app by tapping "a new version is available".
     *
     * Two things have to happen that would not otherwise. The tap has to land
     * on the screen the update is actually on, because arriving at the status
     * card having been promised an update reads as the notification lying. And
     * the check has to be repeated: the background worker found this release in
     * a process that no longer exists, so nothing here knows about it — and
     * that worker recorded a check, so the launch check would decide one is not
     * due and the Updates card would sit there saying nothing at all.
     *
     * The extra is consumed so a rotation does not replay it and yank someone
     * off whichever tab they had since moved to.
     *
     * @return whether this was an update tap, so the caller can skip its own check.
     */
    private fun handleUpdateNotification(intent: Intent?): Boolean {
        if (intent?.getBooleanExtra(UpdateCheckWorker.EXTRA_SHOW_UPDATE, false) != true) {
            // Opened some other way, but seeing the app is reason enough to stop
            // the shade nagging about a version they are on their way to install.
            UpdateCheckWorker.dismissNotification(this)
            return false
        }

        intent.removeExtra(UpdateCheckWorker.EXTRA_SHOW_UPDATE)
        UpdateCheckWorker.dismissNotification(this)
        destination.intValue = SETTINGS_TAB
        viewModel.checkForUpdates()
        return true
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

    /**
     * Installs a downloaded update, collecting whatever is missing on the way.
     *
     * Android will not let an app install a package until the user has allowed
     * it, per app, in a settings screen. That is deliberate on Android's part
     * and this does not try to route around it — it deep-links to the exact
     * screen and explains why, rather than failing with a permission error.
     */
    private fun installUpdate() {
        viewModel.requestInstall(
            onReady = { apk ->
                runCatching { startActivity(Updater.installIntent(this, apk)) }
                    .onFailure { viewModel.reportUpdateProblem("Could not open the installer") }
            },
            onNeedsPermission = {
                viewModel.reportUpdateProblem("Allow Jomma to install apps, then press Install again.")
                runCatching { startActivity(Updater.installPermissionIntent(this)) }
            },
        )
    }

    private fun openGitHub() {
        runCatching {
            startActivity(
                Intent(Intent.ACTION_VIEW, Uri.parse("https://github.com/TahsinFaiyaz30/jomma")),
            )
        }
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
     * Asks Android to stop optimising this app, as a dialog naming it.
     *
     * The previous version opened the system's battery list and left the user
     * to find the app, so there was no way to tell "I turned it off" from "it
     * is off for this app" — and the two are frequently different.
     *
     * Falls back to the list if the direct request is refused, which some ROMs
     * do.
     */
    private fun requestBatteryExemption() {
        val direct = KeepAlive.requestBatteryExemption(this)
        if (direct.resolveActivity(packageManager) != null) {
            runCatching { startActivity(direct) }.onFailure { openBatterySettingsList() }
        } else {
            openBatterySettingsList()
        }
    }

    private fun openBatterySettingsList() {
        runCatching { startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)) }
    }

    /**
     * The vendor's own background-app manager.
     *
     * Separate from Android's battery settings and, on Honor, Huawei, Xiaomi,
     * Oppo, Vivo and Samsung, the actual reason a foreground service dies
     * overnight while every Android setting reads as correct. Falls back to the
     * app-info screen, from which every ROM's own settings are reachable.
     */
    private fun openAutoStartSettings() {
        val vendor = KeepAlive.autoStartIntent(this)
        if (vendor != null) {
            runCatching { startActivity(vendor) }
                .onFailure { startActivity(KeepAlive.appDetailsIntent(this)) }
        } else {
            startActivity(KeepAlive.appDetailsIntent(this))
        }
    }

    private companion object {
        const val HOME_TAB = 0
        const val SETTINGS_TAB = 2
    }
}
