package com.jomma.notifier.ui

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.jomma.notifier.capture.NotificationListener
import com.jomma.notifier.data.Capture
import com.jomma.notifier.data.CaptureRepository
import com.jomma.notifier.data.JommaDatabase
import com.jomma.notifier.data.Prefs
import com.jomma.notifier.net.JommaApi
import com.jomma.notifier.net.ProvisioningPayload
import com.jomma.notifier.service.NotifierService
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
        )
    }

    /** Scanned the provisioning QR. Exchanges the one-time token for a real one. */
    fun provision(scanned: String) {
        val app = getApplication<Application>()
        _state.value = _state.value.copy(busy = true, message = null)

        viewModelScope.launch {
            val payload = runCatching {
                Json { ignoreUnknownKeys = true }
                    .decodeFromString(ProvisioningPayload.serializer(), scanned)
            }.getOrNull()

            if (payload == null) {
                _state.value = _state.value.copy(busy = false, message = "That is not a Jomma QR code.")
                return@launch
            }

            when (val result = JommaApi(app).provision(payload.url, payload.deviceId, payload.token)) {
                is JommaApi.Result.Ok -> {
                    prefs.serverUrl = payload.url
                    prefs.deviceToken = result.value.deviceToken
                    prefs.deviceId = result.value.deviceId
                    prefs.accountMsisdn = result.value.account.msisdn
                    prefs.revoked = false

                    NotifierService.start(app)
                    HeartbeatWorker.schedule(app)
                    WatchdogWorker.schedule(app)

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
