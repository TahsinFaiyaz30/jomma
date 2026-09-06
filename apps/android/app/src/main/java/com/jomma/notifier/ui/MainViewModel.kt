package com.jomma.notifier.ui

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.jomma.notifier.capture.NotificationListener
import com.jomma.notifier.data.Capture
import com.jomma.notifier.data.CaptureRepository
import com.jomma.notifier.data.JommaDatabase
import com.jomma.notifier.data.Prefs
import com.jomma.notifier.net.CaptureSettings
import com.jomma.notifier.net.JommaApi
import com.jomma.notifier.net.PairingLink
import com.jomma.notifier.service.KeepAlive
import com.jomma.notifier.service.NotifierService
import com.jomma.notifier.service.RestartAlarm
import com.jomma.notifier.work.FlushWorker
import com.jomma.notifier.work.HeartbeatWorker
import com.jomma.notifier.work.WatchdogWorker
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import kotlinx.serialization.json.Json

/** Connected | Degraded | Down. The dot is the whole product. */
enum class Health { Connected, Degraded, Down }

data class UiState(
    val provisioned: Boolean = false,
    val revoked: Boolean = false,
    val accountMsisdn: String? = null,
    val serverUrl: String? = null,
    val queueDepth: Int = 0,
    val lastCaptureAt: Long? = null,
    val lastHeartbeatAt: Long = 0,
    val capturedToday: Int = 0,
    val hasNotificationAccess: Boolean = false,
    val hasSmsPermission: Boolean = false,
    /** Android's own exemption. Checked, not assumed — see KeepAlive. */
    val batteryExempt: Boolean = false,
    /** Whether this phone ships a vendor background-app killer worth warning about. */
    val aggressiveVendor: Boolean = false,
    val vendorLabel: String = "",
    val capture: CaptureSettings = CaptureSettings(),
    val captureSaving: Boolean = false,
    val busy: Boolean = false,
    val message: String? = null,
) {
    val health: Health
        get() = when {
            !provisioned || revoked -> Health.Down
            !hasNotificationAccess -> Health.Down
            // A backing queue or a stale beat means it is working but falling
            // behind — worth noticing, not worth panicking about.
            queueDepth > 0 -> Health.Degraded
            !hasSmsPermission -> Health.Degraded
            lastHeartbeatAt == 0L -> Health.Degraded
            System.currentTimeMillis() - lastHeartbeatAt > 15 * 60 * 1000 -> Health.Degraded
            else -> Health.Connected
        }
}

class MainViewModel(app: Application) : AndroidViewModel(app) {

    private val prefs = Prefs.get(app)
    private val dao = JommaDatabase.get(app).captureDao()
    private val repository = CaptureRepository(app)

    private val _state = MutableStateFlow(UiState())
    val state: StateFlow<UiState> = _state.asStateFlow()

    val recentCaptures: StateFlow<List<Capture>> =
        dao.recent(200).stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    init {
        refresh()

        viewModelScope.launch {
            dao.pendingCountFlow().collect { depth ->
                _state.value = _state.value.copy(queueDepth = depth)
            }
        }
        viewModelScope.launch {
            dao.lastCaptureAtFlow().collect { at ->
                _state.value = _state.value.copy(lastCaptureAt = at)
            }
        }
        viewModelScope.launch {
            dao.countSinceFlow(startOfToday()).collect { count ->
                _state.value = _state.value.copy(capturedToday = count)
            }
        }
    }

    /** Re-check permissions on every launch — an update can revoke them silently. */
    fun refresh() {
        val app = getApplication<Application>()
        _state.value = _state.value.copy(
            provisioned = prefs.isProvisioned,
            revoked = prefs.revoked,
            accountMsisdn = prefs.accountMsisdn,
            serverUrl = prefs.serverUrl,
            lastHeartbeatAt = prefs.lastHeartbeatAt,
            hasNotificationAccess = NotificationListener.hasAccess(app),
            hasSmsPermission = HeartbeatWorker.hasSmsPermission(app),
            batteryExempt = KeepAlive.isBatteryOptimisationDisabled(app),
            aggressiveVendor = KeepAlive.isAggressiveVendor,
            vendorLabel = KeepAlive.vendorLabel,
            capture = prefs.capture,
        )

        if (prefs.isProvisioned && !prefs.revoked) refreshCaptureSettings()
    }

    /**
     * Re-reads the capture settings from the server.
     *
     * The cached copy is as old as the last heartbeat, so it can easily be
     * fifteen minutes behind a change made in the dashboard — and much further
     * if the phone has been asleep. A switch showing the wrong position is worse
     * than one that takes a moment to settle, because it will be believed.
     *
     * Silent on failure. This runs on every launch, and an offline phone
     * showing an error banner about a setting nobody was looking at is noise.
     */
    private fun refreshCaptureSettings() {
        viewModelScope.launch {
            val result = JommaApi(getApplication()).captureSettings()
            if (result is JommaApi.Result.Ok) {
                prefs.capture = result.value.capture
                _state.value = _state.value.copy(capture = result.value.capture)
            }
        }
    }

    /**
     * Changes what this number keeps.
     *
     * The switch moves immediately and is put back if the write fails, so a
     * failure is visible rather than silently ignored. The value lives on the
     * account, so this is the same setting the dashboard edits — last write
     * wins, and the loser sees it on the next heartbeat.
     */
    fun setCapture(settings: CaptureSettings) {
        val previous = _state.value.capture
        _state.value = _state.value.copy(capture = settings, captureSaving = true)

        viewModelScope.launch {
            when (val result = JommaApi(getApplication()).updateCaptureSettings(settings)) {
                is JommaApi.Result.Ok -> {
                    prefs.capture = result.value.capture
                    _state.value = _state.value.copy(
                        capture = result.value.capture,
                        captureSaving = false,
                    )
                }

                JommaApi.Result.Revoked -> {
                    _state.value = _state.value.copy(
                        capture = previous,
                        captureSaving = false,
                        revoked = true,
                        message = "This device was revoked. Re-provision it.",
                    )
                }

                is JommaApi.Result.Failed -> {
                    _state.value = _state.value.copy(
                        capture = previous,
                        captureSaving = false,
                        message = "Could not save: ${result.message}",
                    )
                }
            }
        }
    }

    /**
     * Sets this device up from a provisioning link.
     *
     * One function for both ways in, because they arrive as the same string:
     * the app's own scanner decodes `https://host/pair/CODE` off the QR, and a
     * third-party scanner hands the identical URL to Android, which routes it
     * here as an App Link. Neither path is privileged over the other.
     *
     * Ignored once the device is already provisioned. Re-opening an old link
     * from a notification or browser history must not tear down a working
     * device — the code would fail anyway, having been burned, but the failure
     * would show as an alarming message on a phone that is working fine.
     */
    fun provision(scanned: String) {
        val app = getApplication<Application>()

        if (prefs.isProvisioned && !prefs.revoked) {
            _state.value = _state.value.copy(message = "This device is already set up.")
            return
        }

        val link = PairingLink.parse(scanned)
        if (link == null) {
            _state.value = _state.value.copy(busy = false, message = "That is not a Jomma QR code.")
            return
        }

        _state.value = _state.value.copy(busy = true, message = null)

        viewModelScope.launch {
            when (val result = JommaApi(app).pair(link)) {
                is JommaApi.Result.Ok -> {
                    // The server URL comes from the QR, so it is stored only
                    // after that server has answered — a link to somewhere else
                    // never gets written down.
                    prefs.serverUrl = link.serverUrl
                    prefs.deviceToken = result.value.deviceToken
                    prefs.deviceId = result.value.deviceId
                    prefs.accountMsisdn = result.value.account.msisdn
                    prefs.revoked = false

                    NotifierService.start(app)
                    HeartbeatWorker.schedule(app)
                    WatchdogWorker.schedule(app)
                    // The alarm-based recovery, armed as soon as there is
                    // something worth recovering.
                    RestartAlarm.schedule(app)

                    _state.value = _state.value.copy(busy = false, message = "Provisioned.")
                    refresh()
                }

                JommaApi.Result.Revoked ->
                    _state.value = _state.value.copy(
                        busy = false,
                        message = "That code has expired or was already used.",
                    )

                is JommaApi.Result.Failed ->
                    _state.value = _state.value.copy(busy = false, message = result.message)
            }
        }
    }

    fun flushNow() {
        FlushWorker.enqueueNow(getApplication())
        _state.value = _state.value.copy(message = "Flushing…")
    }

    fun heartbeatNow() {
        viewModelScope.launch {
            HeartbeatWorker.beat(getApplication())
            refresh()
        }
    }

    /** Writes a capture through the real path, so the whole chain is exercised. */
    fun sendTestCapture() {
        viewModelScope.launch {
            repository.enqueue(
                source = "notification",
                raw = "Jomma test capture at ${System.currentTimeMillis()}",
                pkg = "com.jomma.notifier",
            )
            FlushWorker.enqueueNow(getApplication())
            _state.value = _state.value.copy(message = "Test capture queued.")
        }
    }

    fun reprovision() {
        prefs.clearCredentials()
        refresh()
    }

    fun dismissMessage() {
        _state.value = _state.value.copy(message = null)
    }

    private fun startOfToday(): Long {
        val now = java.util.Calendar.getInstance()
        now.set(java.util.Calendar.HOUR_OF_DAY, 0)
        now.set(java.util.Calendar.MINUTE, 0)
        now.set(java.util.Calendar.SECOND, 0)
        now.set(java.util.Calendar.MILLISECOND, 0)
        return now.timeInMillis
    }
}
