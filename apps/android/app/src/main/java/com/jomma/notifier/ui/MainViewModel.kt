package com.jomma.notifier.ui

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.jomma.notifier.capture.NotificationListener
import com.jomma.notifier.data.BusinessGroup
import com.jomma.notifier.data.Capture
import com.jomma.notifier.data.CaptureRepository
import com.jomma.notifier.data.JommaDatabase
import com.jomma.notifier.data.Pairing
import com.jomma.notifier.data.Prefs
import com.jomma.notifier.data.SimCard
import com.jomma.notifier.data.SimInventory
import com.jomma.notifier.net.AddableSim
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
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
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

    /**
     * Which merchant the screens are *showing*. Not which ones are running.
     *
     * Every enabled business reports at once, always — switching here changes
     * what is on display and nothing else. Conflating the two would mean a shop
     * stopped being watched because somebody looked at another one.
     */
    val activeBusinessKey: String? = null,
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

    /**
     * The SIMs in this phone, refreshed on every launch.
     *
     * Empty when the permission has not been granted or there is no SIM — the
     * screen tells those apart, because one is a thing to fix and the other is
     * not.
     */
    val sims: List<SimCard> = emptyList(),

    /*
     * The add-an-MFS flow, when it is open.
     *
     * `addingProvider` is which wallet is being added; `addableSims` is what
     * the *server* says can be chosen for it. Asked rather than worked out from
     * `sims`, because whether a number is free depends on what the business
     * already has — which this phone may not be the one holding.
     */
    val addingProvider: String? = null,
    /**
     * Which merchant the wallet is being added *to*.
     *
     * Held rather than taken from [activeBusiness] at the moment of adding.
     * A business can be managed without being the one on display — opening one
     * from Settings does exactly that — and reading the active business here
     * would create the account on whichever shop happened to be showing. The
     * request goes under that shop's credential, so the server would file it
     * there and nothing later could notice.
     */
    val addingBusinessKey: String? = null,
    val addableSims: List<AddableSim> = emptyList(),
    val addBusy: Boolean = false,
    val hasPhoneStatePermission: Boolean = false,
    /* Updates. `availableUpdate` is the version string, or null when current. */
    val updateInterval: String = "Daily",
    val autoDownloadUpdates: Boolean = false,
    val updatesOnUnmeteredOnly: Boolean = true,
    val availableUpdate: String? = null,

    /**
     * Whether the APK for `availableUpdate` is already on disk.
     *
     * Drives what the button says. The action behind it always did the right
     * thing — it downloads first when it has to — but it called itself "Install"
     * either way, so the first press on a fresh update silently spent twelve
     * megabytes of somebody's mobile data instead of installing anything.
     */
    val updateDownloaded: Boolean = false,
    val updateChecking: Boolean = false,
    val updateDownloading: Boolean = false,
    val updateProgress: Int = 0,
    /**
     * The offer row's line: size, progress, or that it is ready to install.
     *
     * Kept apart from [checkStatus] because one string driving both rows made
     * them read identically -- "Downloaded · ready to install" appeared twice,
     * once under a button that does not install anything.
     */
    val updateStatus: String? = null,

    /** The "Check now" row's line: the result of asking, not of downloading. */
    val checkStatus: String? = null,
    val busy: Boolean = false,
    val message: String? = null,

    /**
     * A pairing link that arrived from outside the app, waiting to be confirmed.
     *
     * Null for anything the phone's own scanner read — see [MainViewModel.offerPairingLink].
     */
    val pendingLink: PairingLink? = null,
) {
    val provisioned: Boolean get() = pairings.isNotEmpty()

    /**
     * The merchants this phone helps.
     *
     * Derived from [pairings] rather than carried beside them, so no screen can
     * be handed one without the other. A phone supplies a business with what
     * only a handset has; the numbers belong to the business, so this is what
     * the screens are organised around.
     */
    val businesses: List<BusinessGroup> get() = BusinessGroup.from(pairings)

    /** The merchant on display, falling back to the first this phone paired to. */
    val activeBusiness: BusinessGroup?
        get() = businesses.firstOrNull { it.key == activeBusinessKey } ?: businesses.firstOrNull()

    /** Its pairings, which is what the wallet list and the status card show. */
    val activePairings: List<Pairing> get() = activeBusiness?.pairings ?: emptyList()
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

/** How often to beat while somebody is watching a phone finish setting up. */
private const val SETUP_POLL_MS = 4_000L

/** How often to re-read the pairing file while nothing is waiting. No request. */
private const val IDLE_RECHECK_MS = 30_000L

class MainViewModel(app: Application) : AndroidViewModel(app) {

    private val prefs = Prefs.get(app)

    /** The foreground poll, held so it can be stopped when the screen goes. */
    private var polling: Job? = null
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
            sims = SimInventory.read(app),
            hasPhoneStatePermission = SimInventory.hasPermission(app),
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
                        message = "${pairing.label} was revoked. Pair it again.",
                    )
                }

                JommaApi.Result.AwaitingApproval -> {
                    prefs.updatePairing(deviceId) {
                        it.copy(capture = previous, awaitingApproval = true)
                    }
                    _state.value = _state.value.copy(
                        pairings = prefs.pairings,
                        captureSavingFor = null,
                        message = "Approve ${pairing.label} on the dashboard first.",
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
     * A pairing link that came from outside the app, held for confirmation.
     *
     * `MainActivity` is exported — it has to be, it is the launcher — and an
     * exported activity accepts an *explicit* intent from any other app on the
     * phone regardless of what its intent filters say. So the App Link filter's
     * `android:host` restriction bounds which links Android will route here on
     * its own, and bounds nothing at all about what another app can hand over
     * directly. It needs no permissions to do it.
     *
     * Provisioning straight off that intent meant any installed app could pair
     * this phone with a server of its choosing. The pairing lands
     * `awaitingApproval`, but approval is answered by that same server over the
     * heartbeat, so it approves itself; the account number likewise comes back
     * from the server, so it can claim the number the phone really watches.
     * From there every captured payment message — amount, sender, TrxID,
     * balance — is uploaded to whoever sent the intent.
     *
     * A link cannot be host-checked instead: self-hosted deployments each have
     * their own domain and there is no list to check against. So the question
     * goes to the person holding the phone, naming the server. One tap, and
     * only on this path — the in-app scanner still provisions immediately,
     * because pointing the camera at a code *is* the confirmation.
     */
    fun offerPairingLink(scanned: String) {
        val link = PairingLink.parse(scanned)
        if (link == null) {
            _state.value = _state.value.copy(busy = false, message = "That is not a Jomma QR code.")
            return
        }
        _state.value = _state.value.copy(pendingLink = link, message = null)
    }

    /** Goes ahead with a link the user has just been shown and accepted. */
    fun confirmPendingLink() {
        val link = _state.value.pendingLink ?: return
        _state.value = _state.value.copy(pendingLink = null)
        provision("${link.serverUrl}/pair/${link.code}")
    }

    fun dismissPendingLink() {
        _state.value = _state.value.copy(pendingLink = null)
    }

    /**
     * Sets this device up from a provisioning link.
     *
     * Reached directly by the app's own scanner, and via [offerPairingLink]
     * once an externally-supplied link has been confirmed.
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
                    /*
                     * Null when the code paired this phone to a business rather
                     * than to a number, which is the ordinary first step now.
                     * The pairing is still stored: it holds a working
                     * credential, and heartbeating with it is how the dashboard
                     * learns which SIMs are in this phone. Choosing one there
                     * sends down a second code that does carry an account.
                     */
                    val msisdn = result.value.account?.msisdn

                    if (msisdn != null && prefs.watches(msisdn)) {
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
                            businessId = result.value.business?.id,
                            businessName = result.value.business?.name,
                            accountMsisdn = msisdn,
                            provider = result.value.account?.provider,
                            // Scanning is no longer the last step: the phone is
                            // inert until the dashboard approves it. True for
                            // every scanned QR — the server only says otherwise
                            // for a code it bound to this handset itself.
                            awaitingApproval = result.value.awaitingApproval,
                        ),
                    )

                    NotifierService.start(app)
                    HeartbeatWorker.schedule(app)
                    WatchdogWorker.schedule(app)
                    // The alarm-based recovery, armed as soon as there is
                    // something worth recovering.
                    RestartAlarm.schedule(app)

                    /*
                     * Two outcomes, two sentences.
                     *
                     * Interpolating the msisdn was right when every code
                     * carried one. A business code does not, so this said
                     * "null added" — and the next step is not the same either:
                     * an account still has to be chosen before there is
                     * anything to approve.
                     */
                    _state.value = _state.value.copy(
                        busy = false,
                        message = if (msisdn == null) {
                            "Phone connected. Choose the SIM it is paid on, in the dashboard."
                        } else {
                            "$msisdn added. Approve it on the dashboard to start capturing."
                        },
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
            // Not this caller's list to choose. A phone waiting for approval is
            // exactly the one somebody presses this for, and the old filter made
            // the button unable to resolve the only thing it was wanted for.
            HeartbeatWorker.beatAll(getApplication())
            refresh()
        }
    }

    /**
     * Beats every few seconds while a phone is mid-setup and this screen is on.
     *
     * The periodic worker runs every fifteen minutes, which is the right
     * interval for a phone that is simply reporting for duty and the wrong one
     * for somebody holding the handset in one hand and the dashboard in the
     * other. Approving on the web and waiting a quarter of an hour for the app
     * to notice reads as a broken app, and the same gap sits in front of the
     * next step: choosing the SIM needs the phone to have reported its SIMs,
     * which it only does on a beat.
     *
     * Bounded on both sides. It runs only while something is actually waiting —
     * unapproved, or approved with no number yet — and only between [onVisible]
     * and [onHidden], so nothing polls in the background or once setup is done.
     */
    fun onVisible() {
        if (polling?.isActive == true) return
        polling = viewModelScope.launch {
            while (true) {
                if (!prefs.settingUp) {
                    // Cheap and local: no request, just a re-read of the file,
                    // waiting for a scan that may never happen on this screen.
                    delay(IDLE_RECHECK_MS)
                    continue
                }
                HeartbeatWorker.beatAll(getApplication())
                refresh()
                delay(SETUP_POLL_MS)
            }
        }
    }

    fun onHidden() {
        polling?.cancel()
        polling = null
    }

    /**
     * Writes a capture through the real path, so the whole chain is exercised.
     *
     * Against the first live number, because the point is to prove the pipe
     * works at all rather than to test a particular account — and sending one
     * per number would put a test message in every merchant's feed.
     */
    fun sendTestCapture() {
        /*
         * A live pairing that has a number, not merely a live pairing.
         *
         * The account-less business pairing is live — it is approved and it
         * beats — but the capture endpoint refuses it with "No number is set up
         * on this phone yet", because there is no account to file a capture
         * against. Taking the first live pairing meant the test button reported
         * a failure on a phone where everything worked.
         */
        val pairing = prefs.livePairings.firstOrNull { it.accountMsisdn != null }
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
        val app = getApplication<Application>()

        viewModelScope.launch {
            // Given back rather than merely dropped, so the dashboard stops
            // showing an active device that no longer exists.
            val told = pairing.revoked || JommaApi(app, pairing).revokeSelf() is JommaApi.Result.Ok

            dao.deleteFor(deviceId)
            prefs.removePairing(deviceId)
            _state.value = _state.value.copy(
                pairings = prefs.pairings,
                message = if (told) {
                    "${pairing.label} removed. The dashboard shows it as revoked."
                } else {
                    "${pairing.label} removed from this phone. " +
                        "The dashboard could not be reached — revoke it there too."
                },
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
    /**
     * Switches this phone's reporting for one business on or off.
     *
     * Local, and deliberately not a server call. The dashboard learns about it
     * from the next heartbeat, which is soon enough for a state the merchant
     * cannot change from their end anyway — and doing it this way means the
     * switch still works on a phone with no signal, which is exactly when
     * somebody is most likely to reach for it.
     */
    /**
     * Opens the "add a wallet" flow for one provider, and asks what it could
     * use.
     *
     * The list comes from the server rather than from `sims`: a number is free
     * or not depending on what this *business* already watches, and the phone
     * holding it is not necessarily the phone that added the others.
     */
    /**
     * A working credential for the merchant currently on screen.
     *
     * Not simply the first live pairing. A handset can hold credentials for
     * several shops, and taking whichever sorted first meant a wallet added
     * while looking at one shop was created on another — the request goes under
     * that credential, so the server files it against that business and there
     * is nothing later to notice the mistake.
     */
    private fun credentialFor(key: String?): Pairing? {
        val group = key?.let { prefs.business(it) }
            ?: _state.value.activeBusiness
            ?: prefs.businesses.firstOrNull()
        return group?.pairings?.firstOrNull { it.live }
    }

    fun startAddingAccount(businessKey: String, provider: String) {
        val pairing = credentialFor(businessKey)
        if (pairing == null) {
            _state.value = _state.value.copy(
                message = "Connect this phone first, and have it approved.",
            )
            return
        }

        _state.value = _state.value.copy(
            addingProvider = provider,
            addingBusinessKey = businessKey,
            addableSims = emptyList(),
            addBusy = true,
        )

        viewModelScope.launch {
            when (val result = JommaApi(getApplication(), pairing).addableSims(provider)) {
                is JommaApi.Result.Ok -> _state.value = _state.value.copy(
                    addableSims = result.value.sims,
                    addBusy = false,
                )

                else -> _state.value = _state.value.copy(
                    addBusy = false,
                    addingProvider = null,
                    addingBusinessKey = null,
                    message = "Could not read the numbers. Check the connection and try again.",
                )
            }
        }
    }

    fun cancelAddingAccount() {
        _state.value = _state.value.copy(
            addingProvider = null,
            addingBusinessKey = null,
            addableSims = emptyList(),
        )
    }

    /**
     * Adds the chosen number for the wallet being added.
     *
     * Nothing is stored locally on success. The server queues an `add_account`
     * command, and the next heartbeat redeems it exactly as it redeems a
     * scanned code — so there is one path that turns a code into a pairing, not
     * two.
     */
    fun addAccount(subscriptionId: Int) {
        val provider = _state.value.addingProvider ?: return
        // The business whose screen this was started from — not whichever one
        // happens to be on display. See .
        val pairing = credentialFor(_state.value.addingBusinessKey) ?: return

        _state.value = _state.value.copy(addBusy = true)

        viewModelScope.launch {
            when (val result = JommaApi(getApplication(), pairing).addAccount(subscriptionId, provider)) {
                is JommaApi.Result.Ok -> {
                    _state.value = _state.value.copy(
                        addBusy = false,
                        addingProvider = null,
                    addingBusinessKey = null,
                        addableSims = emptyList(),
                        message = "${result.value.msisdn} added for $provider. " +
                            "Enable it on the dashboard when you are ready to take payments.",
                    )
                    // Pulls the queued command down now rather than at the next
                    // scheduled beat, so the number appears while somebody is
                    // still looking at the screen that added it.
                    heartbeatNow()
                }

                is JommaApi.Result.Failed -> _state.value = _state.value.copy(
                    addBusy = false,
                    message = result.message,
                )

                else -> _state.value = _state.value.copy(
                    addBusy = false,
                    message = "Could not add that number.",
                )
            }
        }
    }

    fun setSendingEnabled(deviceId: String, enabled: Boolean) {
        prefs.updatePairing(deviceId) { it.copy(sendingEnabled = enabled) }
        _state.value = _state.value.copy(
            pairings = prefs.pairings,
            message = if (enabled) "Reporting resumed" else "Reporting paused for this business",
        )
        // Tell the dashboard now rather than at the next scheduled beat, so the
        // pause shows up while the person who caused it is still watching. The
        // pairing still beats while paused -- that is how the dashboard knows
        // the difference between paused and gone.
        val app = getApplication<Application>()
        viewModelScope.launch {
            prefs.pairing(deviceId)?.takeIf { it.live }?.let { HeartbeatWorker.beat(app, it) }
            refresh()
        }
    }

    /**
     * Which merchant the screens show. Purely a view.
     *
     * Every enabled business goes on reporting regardless of what is selected —
     * the phone is watching all of them at once, and this only decides whose
     * numbers and whose status card are in front of you. Somebody looking at
     * one shop must never stop another from being watched.
     */
    fun setActiveBusiness(key: String) {
        _state.value = _state.value.copy(activeBusinessKey = key)
    }

    /**
     * Switches reporting for a whole merchant on or off.
     *
     * Not an unpairing: the credentials survive, the phone keeps beating, and
     * every beat carries the flag — which is how the dashboard shows "the phone
     * has paused this" rather than a handset that has simply gone quiet. That
     * distinction is the whole reason this is a switch and not a Remove.
     *
     * Beat immediately, once per credential, so the merchant watching their own
     * dashboard sees it while they are still watching rather than up to five
     * minutes later.
     */
    fun setBusinessEnabled(key: String, enabled: Boolean) {
        val group = prefs.business(key) ?: return
        prefs.setBusinessEnabled(key, enabled)

        _state.value = _state.value.copy(
            pairings = prefs.pairings,
            message = if (enabled) {
                "Reporting resumed for ${group.name}."
            } else {
                "Paused for ${group.name}. Nothing is captured for it, and nothing is held."
            },
        )

        val app = getApplication<Application>()
        viewModelScope.launch {
            for (pairing in prefs.business(key)?.pairings.orEmpty()) {
                if (pairing.live) HeartbeatWorker.beat(app, pairing)
            }
            refresh()
        }
    }

    /**
     * Stops helping a merchant altogether, and says so on their dashboard.
     *
     * Distinct from the switch above, which pauses: this gives the credentials
     * back. Every pairing for the business is revoked on the server first and
     * only then forgotten here, so the dashboard shows the phone as revoked
     * rather than as an active device that has mysteriously gone quiet.
     *
     * Forgetting happens even when the server could not be reached. The
     * alternative — refusing to disconnect while offline — leaves somebody
     * holding a phone that goes on capturing for a merchant they have finished
     * with, which is worse than a stale row on a dashboard. The message says
     * which of the two happened, because only one of them needs following up.
     */
    fun disconnectBusiness(key: String) {
        val group = prefs.business(key) ?: return
        val app = getApplication<Application>()

        viewModelScope.launch {
            var toldTheServer = true
            for (pairing in group.pairings) {
                /*
                 * A pairing that was already revoked has nothing to give back,
                 * and its token no longer authenticates — asking would answer
                 * 401 and read as a failure that needs chasing.
                 */
                if (pairing.revoked) continue
                if (JommaApi(app, pairing).revokeSelf() !is JommaApi.Result.Ok) toldTheServer = false
            }

            for (pairing in group.pairings) {
                dao.deleteFor(pairing.deviceId)
                prefs.removePairing(pairing.deviceId)
            }

            _state.value = _state.value.copy(
                pairings = prefs.pairings,
                // Do not go on showing a business that is gone.
                activeBusinessKey = prefs.businesses.firstOrNull()?.key,
                message = if (toldTheServer) {
                    "Disconnected from ${group.name}. Its dashboard shows this phone as revoked."
                } else {
                    "Disconnected from ${group.name} on this phone. " +
                        "Its dashboard could not be reached — revoke it there too."
                },
            )
            refresh()
        }
    }

    /**
     * Stops helping every merchant at once, and tells each of them.
     *
     * The phone-level act, and deliberately not a loop over the per-business one
     * at the call site: that produced a separate confirmation per shop, so
     * somebody disconnecting a handset with four businesses on it was told four
     * times and could not tell whether any had failed.
     *
     * Every dashboard learns independently. A handset going back in a drawer
     * should not leave four merchants each showing an active phone that stopped
     * reporting for reasons nobody wrote down.
     */
    fun disconnectEverything() {
        val all = prefs.pairings
        if (all.isEmpty()) return
        val app = getApplication<Application>()
        val shops = prefs.businesses.size

        viewModelScope.launch {
            var unreachable = 0
            for (pairing in all) {
                if (pairing.revoked) continue
                if (JommaApi(app, pairing).revokeSelf() !is JommaApi.Result.Ok) unreachable++
            }

            for (pairing in all) {
                dao.deleteFor(pairing.deviceId)
                prefs.removePairing(pairing.deviceId)
            }

            _state.value = _state.value.copy(
                pairings = prefs.pairings,
                activeBusinessKey = null,
                message = if (unreachable == 0) {
                    "Disconnected from $shops business(es). Each dashboard shows this phone " +
                        "as revoked."
                } else {
                    // Named rather than glossed: the ones that did not go through
                    // are the only ones anybody has to act on.
                    "Disconnected on this phone. $unreachable credential(s) could not be " +
                        "handed back — revoke this phone on those dashboards too."
                },
            )
            refresh()
        }
    }

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
        // Same reset as `deleteDownload`, since it is the same deletion.
        if (!enabled) deleteDownload()
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
            checkStatus = if (silent) _state.value.checkStatus else "Checking…",
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
                        updateDownloaded = downloaded != null,
                        checkStatus = "Version ${result.update.version} available",
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
                        updateDownloaded = false,
                        checkStatus = "Up to date · ${result.version}",
                        updateStatus = null,
                    )
                }

                is Updater.CheckResult.Failed ->
                    _state.value = _state.value.copy(
                        updateChecking = false,
                        checkStatus = if (silent) {
                            _state.value.checkStatus
                        } else {
                            "Could not check: ${result.message}"
                        },
                    )
            }
        }
    }

    /** Fetches the APK. Public because the button now says "Download" and means it. */
    fun downloadUpdate() {
        val update = pending ?: return
        if (_state.value.updateDownloading) return
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
                updateDownloaded = file != null,
                updateStatus = if (file == null) "Download failed" else "Downloaded · ready to install",
            )
        }
    }

    /**
     * Throws away a downloaded APK without installing it.
     *
     * Twelve megabytes on a phone that often has very little, held for an update
     * somebody has decided not to take yet. Nothing else offered a way to get it
     * back short of clearing the app's storage, which would take the pairings
     * with it.
     *
     * The update itself stays on offer — this deletes the file, not the fact
     * that a newer version exists, so the button simply returns to "Download".
     */
    fun deleteDownload() {
        // Clears the whole cache, not only the file this session knows about —
        // an interrupted download or one left by a superseded version is
        // referenced by nothing and is exactly the space worth reclaiming.
        val freed = Updater.clearDownloads(getApplication())
        downloaded = null
        _state.value = _state.value.copy(
            updateDownloaded = false,
            updateProgress = 0,
            updateStatus = pending?.let { "${it.sizeLabel} · not downloaded yet" },
            message = if (freed > 0) "Deleted ${freed / 1_000_000} MB" else "Nothing to delete",
        )
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
        // Keep the button honest: if the purge took the file, it says "Download"
        // again rather than offering to install something no longer there.
        _state.value = _state.value.copy(updateDownloaded = downloaded != null)
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
