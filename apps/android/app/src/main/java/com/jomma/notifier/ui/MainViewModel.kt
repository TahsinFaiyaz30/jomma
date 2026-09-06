package com.jomma.notifier.ui

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.jomma.notifier.capture.NotificationListener
import com.jomma.notifier.data.Capture
import com.jomma.notifier.data.CaptureRepository
import com.jomma.notifier.data.JommaDatabase
import com.jomma.notifier.data.Pairing
import com.jomma.notifier.data.Prefs
import com.jomma.notifier.net.CaptureSettings
import com.jomma.notifier.net.JommaApi
import com.jomma.notifier.net.PairingLink
import com.jomma.notifier.service.KeepAlive
import com.jomma.notifier.service.NotifierService
import com.jomma.notifier.service.RestartAlarm
import com.jomma.notifier.update.AvailableUpdate
import com.jomma.notifier.update.InstallReceiver
import com.jomma.notifier.update.UpdateCheckWorker
import com.jomma.notifier.update.UpdateInterval
import com.jomma.notifier.update.Updater
import java.io.File
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
    /**
     * Every number this phone watches, each with its own credential, capture
     * settings and approval state.
     *
     * A list rather than a set of nullable fields, because "the account" and
     * "the token" stopped being meaningful phrases the moment a phone could
     * hold three of them.
     */
    val pairings: List<Pairing> = emptyList(),
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
    /** Which number's settings are mid-save, so only that row shows a spinner. */
    val captureSavingFor: String? = null,
    /* Updates. `availableUpdate` is the version string, or null when current. */
    val updateInterval: String = "Daily",
    val autoDownloadUpdates: Boolean = false,
    val updatesOnUnmeteredOnly: Boolean = true,
    val availableUpdate: String? = null,
    val updateChecking: Boolean = false,
    val updateDownloading: Boolean = false,
    val updateProgress: Int = 0,
    val updateStatus: String? = null,
    val busy: Boolean = false,
    val message: String? = null,
) {
    val provisioned: Boolean get() = pairings.isNotEmpty()
    val livePairings: List<Pairing> get() = pairings.filter { it.live }
    val awaitingApproval: List<Pairing> get() = pairings.filter { it.awaitingApproval }

    val health: Health
        get() = when {
            // Down only when *nothing* works. One revoked number among three is
            // a problem on that row, not a dead phone.
            pairings.isEmpty() || livePairings.isEmpty() -> Health.Down
            !hasNotificationAccess -> Health.Down
            // Some numbers working and some not is exactly "degraded".
            livePairings.size < pairings.size -> Health.Degraded
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
        /*
         * How an install actually went. Android answers a committed session by
         * broadcast, so the outcome arrives at InstallReceiver rather than at
         * whatever called it — this is the wire back to the screen.
         */
        viewModelScope.launch {
            InstallReceiver.messages.collect { message ->
                _state.value = _state.value.copy(updateStatus = message)
            }
        }
    }

    /** Re-check permissions on every launch — an update can revoke them silently. */
    fun refresh() {
        val app = getApplication<Application>()
        _state.value = _state.value.copy(
            pairings = prefs.pairings,
            lastHeartbeatAt = prefs.lastHeartbeatAt,
            hasNotificationAccess = NotificationListener.hasAccess(app),
            hasSmsPermission = HeartbeatWorker.hasSmsPermission(app),
            batteryExempt = KeepAlive.isBatteryOptimisationDisabled(app),
            aggressiveVendor = KeepAlive.isAggressiveVendor,
            vendorLabel = KeepAlive.vendorLabel,
            updateInterval = prefs.updateInterval,
            autoDownloadUpdates = prefs.autoDownloadUpdates,
            updatesOnUnmeteredOnly = prefs.updatesOnUnmeteredOnly,
        )

        // Each live number separately: they are different accounts on the
        // server with different settings.
        for (pairing in prefs.livePairings) refreshCaptureSettings(pairing)
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
    private fun refreshCaptureSettings(pairing: Pairing) {
        viewModelScope.launch {
            val result = JommaApi(getApplication(), pairing).captureSettings()
            if (result is JommaApi.Result.Ok) {
                prefs.updatePairing(pairing.deviceId) { it.copy(capture = result.value.capture) }
                _state.value = _state.value.copy(pairings = prefs.pairings)
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
    fun setCapture(deviceId: String, settings: CaptureSettings) {
        val pairing = prefs.pairing(deviceId) ?: return
        val previous = pairing.capture

        // Optimistic, and per number — the other rows must not freeze because
        // this one is saving.
        prefs.updatePairing(deviceId) { it.copy(capture = settings) }
        _state.value = _state.value.copy(pairings = prefs.pairings, captureSavingFor = deviceId)

        viewModelScope.launch {
            val api = JommaApi(getApplication(), pairing)
            when (val result = api.updateCaptureSettings(settings)) {
                is JommaApi.Result.Ok -> {
                    prefs.updatePairing(deviceId) { it.copy(capture = result.value.capture) }
                    _state.value = _state.value.copy(
                        pairings = prefs.pairings,
                        captureSavingFor = null,
                    )
                }

                JommaApi.Result.Revoked -> {
                    prefs.updatePairing(deviceId) { it.copy(capture = previous, revoked = true) }
                    _state.value = _state.value.copy(
                        pairings = prefs.pairings,
                        captureSavingFor = null,
                        message = "${pairing.accountMsisdn} was revoked. Pair it again.",
                    )
                }

                JommaApi.Result.AwaitingApproval -> {
                    prefs.updatePairing(deviceId) {
                        it.copy(capture = previous, awaitingApproval = true)
                    }
                    _state.value = _state.value.copy(
                        pairings = prefs.pairings,
                        captureSavingFor = null,
                        message = "Approve ${pairing.accountMsisdn} on the dashboard first.",
                    )
                }

                is JommaApi.Result.Failed -> {
                    prefs.updatePairing(deviceId) { it.copy(capture = previous) }
                    _state.value = _state.value.copy(
                        pairings = prefs.pairings,
                        captureSavingFor = null,
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
     * Scanning again *adds a number* rather than being refused. That is the
     * whole point of the plus button: one phone can hold a bKash account and a
     * Nagad account, or two SIMs, and each is a separate device row on the
     * server with its own token. Nothing is asked of the person holding the
     * phone — the code says which number it is and the server answers with the
     * rest.
     *
     * What is still refused is the same *number* twice, which would create a
     * second device row for one account and double every capture from it.
     */
    fun provision(scanned: String) {
        val app = getApplication<Application>()

        val link = PairingLink.parse(scanned)
        if (link == null) {
            _state.value = _state.value.copy(busy = false, message = "That is not a Jomma QR code.")
            return
        }

        _state.value = _state.value.copy(busy = true, message = null)

        viewModelScope.launch {
            when (val result = JommaApi(app).pair(link)) {
                is JommaApi.Result.Ok -> {
                    val msisdn = result.value.account.msisdn

                    if (prefs.watches(msisdn)) {
                        _state.value = _state.value.copy(
                            busy = false,
                            message = "$msisdn is already set up on this phone.",
                        )
                        return@launch
                    }

                    // The server URL comes from the QR, so it is stored only
                    // after that server has answered — a link to somewhere else
                    // never gets written down.
                    prefs.upsertPairing(
                        Pairing(
                            deviceId = result.value.deviceId,
                            deviceToken = result.value.deviceToken,
                            serverUrl = link.serverUrl,
                            accountMsisdn = msisdn,
                            provider = result.value.account.provider,
                            // Scanning is no longer the last step: the phone is
                            // inert until the dashboard approves it.
                            awaitingApproval = true,
                        ),
                    )

                    NotifierService.start(app)
                    HeartbeatWorker.schedule(app)
                    WatchdogWorker.schedule(app)
                    // The alarm-based recovery, armed as soon as there is
                    // something worth recovering.
                    RestartAlarm.schedule(app)

                    _state.value = _state.value.copy(
                        busy = false,
                        message = "$msisdn added. Approve it on the dashboard to start capturing.",
                    )
                    refresh()
                }

                JommaApi.Result.Revoked ->
                    _state.value = _state.value.copy(
                        busy = false,
                        message = "That code has expired or was already used.",
                    )

                JommaApi.Result.AwaitingApproval ->
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
            for (pairing in prefs.livePairings) HeartbeatWorker.beat(getApplication(), pairing)
            refresh()
        }
    }

    /**
     * Writes a capture through the real path, so the whole chain is exercised.
     *
     * Against the first live number, because the point is to prove the pipe
     * works at all rather than to test a particular account — and sending one
     * per number would put a test message in every merchant's feed.
     */
    fun sendTestCapture() {
        val pairing = prefs.livePairings.firstOrNull()
        if (pairing == null) {
            _state.value = _state.value.copy(message = "No approved number to test with.")
            return
        }

        viewModelScope.launch {
            repository.enqueue(
                pairing = pairing,
                source = "notification",
                raw = "Jomma test capture at ${System.currentTimeMillis()}",
                pkg = "com.jomma.notifier",
            )
            FlushWorker.enqueueNow(getApplication())
            _state.value = _state.value.copy(message = "Test capture queued.")
        }
    }

    /**
     * Forgets one number.
     *
     * Its queued captures go too. They can only be sent under a credential this
     * phone no longer holds, so keeping them would be keeping rows that can
     * never leave — and the operator would be looking at a queue depth that
     * never falls.
     */
    fun removePairing(deviceId: String) {
        val pairing = prefs.pairing(deviceId) ?: return

        viewModelScope.launch {
            dao.deleteFor(deviceId)
            prefs.removePairing(deviceId)
            _state.value = _state.value.copy(
                pairings = prefs.pairings,
                message = "${pairing.accountMsisdn} removed from this phone.",
            )
            refresh()
        }
    }

    /**
     * Which SIM a number's SMS arrives on.
     *
     * Only ever asked when two pairings share a provider and are otherwise
     * indistinguishable — see Attribution.
     */
    fun setSubscriptionId(deviceId: String, subscriptionId: Int?) {
        prefs.updatePairing(deviceId) { it.copy(subscriptionId = subscriptionId) }
        _state.value = _state.value.copy(pairings = prefs.pairings)
    }

    fun dismissMessage() {
        _state.value = _state.value.copy(message = null)
    }

    /* ── Updates ─────────────────────────────────────────────────────────── */

    /** The release the last check found, kept so it can be downloaded on demand. */
    private var pending: AvailableUpdate? = null
    private var downloaded: File? = null

    fun setUpdateInterval(interval: UpdateInterval) {
        prefs.updateInterval = interval.name
        _state.value = _state.value.copy(updateInterval = interval.name)
        val app = getApplication<Application>()
        if (interval == UpdateInterval.Never) {
            UpdateCheckWorker.cancel(app)
        } else {
            UpdateCheckWorker.schedule(app)
        }
    }

    fun setAutoDownloadUpdates(enabled: Boolean) {
        prefs.autoDownloadUpdates = enabled
        _state.value = _state.value.copy(autoDownloadUpdates = enabled)
        // Turning it off should also reclaim the space, not just stop fetching.
        if (!enabled) Updater.clearDownloads(getApplication())
    }

    fun setUpdatesOnUnmeteredOnly(enabled: Boolean) {
        prefs.updatesOnUnmeteredOnly = enabled
        _state.value = _state.value.copy(updatesOnUnmeteredOnly = enabled)
    }

    /**
     * Looks for a new release.
     *
     * @param silent true when this runs automatically on launch, so a phone
     *   with no signal does not greet its owner with a failure they did not ask
     *   for. A check they pressed a button for always reports what happened.
     */
    fun checkForUpdates(silent: Boolean = false) {
        if (_state.value.updateChecking) return
        _state.value = _state.value.copy(
            updateChecking = true,
            updateStatus = if (silent) _state.value.updateStatus else "Checking…",
        )

        viewModelScope.launch {
            val app = getApplication<Application>()
            when (val result = Updater.check(app)) {
                is Updater.CheckResult.Available -> {
                    pending = result.update
                    prefs.lastUpdateCheckAt = System.currentTimeMillis()
                    downloaded = Updater.downloadedFile(app, result.update)
                    _state.value = _state.value.copy(
                        updateChecking = false,
                        availableUpdate = result.update.version,
                        updateStatus = if (downloaded != null) {
                            "Downloaded · ready to install"
                        } else {
                            "${result.update.sizeLabel} · not downloaded yet"
                        },
                    )
                    if (prefs.autoDownloadUpdates && downloaded == null &&
                        Updater.canDownloadNow(app)
                    ) {
                        downloadUpdate()
                    }
                }

                is Updater.CheckResult.UpToDate -> {
                    pending = null
                    prefs.lastUpdateCheckAt = System.currentTimeMillis()
                    Updater.clearDownloads(app)
                    _state.value = _state.value.copy(
                        updateChecking = false,
                        availableUpdate = null,
                        updateStatus = "Up to date · ${result.version}",
                    )
                }

                is Updater.CheckResult.Failed ->
                    _state.value = _state.value.copy(
                        updateChecking = false,
                        updateStatus = if (silent) null else "Could not check: ${result.message}",
                    )
            }
        }
    }

    private fun downloadUpdate() {
        val update = pending ?: return
        val app = getApplication<Application>()

        if (!Updater.canDownloadNow(app)) {
            _state.value = _state.value.copy(
                updateStatus = "Waiting for Wi-Fi. Turn off \"Wi-Fi only\" to use mobile data.",
            )
            return
        }

        _state.value = _state.value.copy(updateDownloading = true, updateProgress = 0)
        viewModelScope.launch {
            val file = Updater.download(app, update) { percent ->
                _state.value = _state.value.copy(updateProgress = percent)
            }
            downloaded = file
            _state.value = _state.value.copy(
                updateDownloading = false,
                updateStatus = if (file == null) "Download failed" else "Downloaded · ready to install",
            )
        }
    }

    /**
     * What the Install button does, which depends on where things stand.
     *
     * Download first if it has not happened, then commit an install session.
     * The permission gate stays a callback because only the Activity can open
     * the settings screen it points at; the install itself does not, since
     * `PackageInstaller` raises its own confirmation from [InstallReceiver] and
     * needs nothing from the UI to do it.
     */
    fun requestInstall(onNeedsPermission: () -> Unit) {
        val app = getApplication<Application>()
        val file = downloaded

        if (file == null) {
            downloadUpdate()
            return
        }
        if (!Updater.canInstall(app)) {
            onNeedsPermission()
            return
        }

        // Copying twelve megabytes into a session is not instant, and a button
        // that looks like it did nothing gets pressed again.
        _state.value = _state.value.copy(updateStatus = "Preparing the install…")
        viewModelScope.launch {
            Updater.install(app, file)?.let { error ->
                _state.value = _state.value.copy(updateStatus = error)
            }
        }
    }

    /** Surfaces an update problem in the same place as its status. */
    fun reportUpdateProblem(message: String) {
        _state.value = _state.value.copy(updateStatus = message)
    }

    /**
     * Drops a cached APK the running build has caught up with.
     *
     * Run on launch, which is the only moment this can be judged: a successful
     * install replaces the process, so the version now running is the answer to
     * whether the download did its job. Either it did — and twelve megabytes of
     * it are dead weight — or it was abandoned for a release that has since
     * shipped, and it is dead weight for a different reason.
     */
    fun purgeStaleDownloads() {
        Updater.purgeInstalledDownloads(getApplication())
        downloaded = downloaded?.takeIf { it.isFile }
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
