package com.jomma.notifier.data

import com.jomma.notifier.net.CaptureSettings
import kotlinx.serialization.Serializable

/**
 * One watched number, and the credential that lets this phone report for it.
 *
 * The app holds a list of these rather than a single set of fields, because one
 * phone can hold more than one number — two SIMs, or a bKash account and a
 * Nagad account side by side. Each is a separate device row on the server with
 * its own token, so a phone losing access to one number does not lose the
 * others, and revoking one from the dashboard leaves the rest working.
 *
 * Everything here comes from pairing. Nothing is asked of the person holding
 * the phone: they scan a code and the server answers with which number it is,
 * which provider, and what to capture. Adding a second number is the same
 * gesture again.
 */
@Serializable
data class Pairing(
    /** Server-assigned. Also the stable key for everything local. */
    val deviceId: String,
    val deviceToken: String,
    /** Taken from the QR that produced this pairing, so each may differ. */
    val serverUrl: String,
    /**
     * The number this pairing watches, or null until one is chosen.
     *
     * Null is the ordinary state for a phone that has just scanned a business
     * code. It has a working credential and heartbeats with it — that is how
     * the dashboard learns which SIMs are in this phone and has anything to
     * offer — but there is no account behind it yet, so nothing is captured
     * for it. Picking a SIM creates a second pairing that does have one.
     */
    val accountMsisdn: String?,
    val provider: String?,
    /** What the server says to keep for this number. Per number, not per app. */
    val capture: CaptureSettings = CaptureSettings(),

    /**
     * Which SIM this number's messages arrive on.
     *
     * Set when the account was added by picking a SIM, which is now the only
     * way — it used to be a question asked afterwards, and only when two
     * pairings had become indistinguishable. Null on a pairing carried over
     * from before that, and on one whose SIM has since been removed.
     */
    val subscriptionId: Int? = null,

    /**
     * What that SIM's own number was when this pairing was bound to it.
     *
     * The failsafe. A subscription id is Android's handle for a SIM, not the
     * SIM itself, and handles get reused: pull a SIM out, put a different one
     * in the same slot, and messages from a stranger's number can arrive under
     * an id this phone still believes it knows. Nothing about the id would say
     * so.
     *
     * So the binding records the number too, and every capture re-reads what
     * the SIM in that subscription says it is now. Disagreement means the SIM
     * was changed, and the capture is refused rather than posted to an account
     * it may no longer belong to. Canonical `8801XXXXXXXXX`, the same form the
     * server stores, so the two can simply be compared.
     */
    val simMsisdn: String? = null,

    /**
     * Set when the server has answered 401 for this pairing specifically.
     *
     * Per pairing rather than app-wide: one number being revoked from the
     * dashboard must not stop the others reporting, and the old single flag
     * would have taken the whole phone down with it.
     */
    val revoked: Boolean = false,

    /**
     * The phone has scanned and is waiting for the dashboard to approve it.
     *
     * Scanning a code no longer earns a working device — see the server's
     * DEVICE_STATUSES. Held here so the screen can say "waiting for approval"
     * rather than showing a number that looks paired and silently captures
     * nothing.
     */
    val awaitingApproval: Boolean = true,

    /**
     * Whether this phone is currently reporting for this business at all.
     *
     * A switch on the phone, and only on the phone. Somebody helping two shops
     * from one handset needs to be able to stop helping one of them for an
     * afternoon without unpairing, without touching either dashboard, and
     * without the other shop noticing anything.
     *
     * Off means nothing is captured for it — not queued and sent later, not
     * held. Holding would build a backlog that arrives in a burst whenever the
     * switch goes back on, which is a worse surprise than the gap it was meant
     * to avoid.
     *
     * The heartbeat keeps running while it is off, and carries this flag, so
     * the dashboard can say "the phone has paused this" rather than showing a
     * merchant a phone that has silently gone quiet.
     */
    val sendingEnabled: Boolean = true,

    val pairedAt: Long = System.currentTimeMillis(),
    val lastHeartbeatAt: Long = 0,
) {
    /**
     * Whether the credential works: approved by the dashboard, not since
     * revoked. Says nothing about whether the phone is choosing to use it.
     */
    val live: Boolean get() = !revoked && !awaitingApproval

    /**
     * Whether messages for this business should be captured right now.
     *
     * Distinct from [live] on purpose. A revoked pairing cannot report; a
     * paused one could and is choosing not to, so it still heartbeats and still
     * says so. Conflating them would make a phone that has been switched off
     * for one shop indistinguishable from one that has been thrown away.
     */
    val capturing: Boolean get() = live && sendingEnabled && accountMsisdn != null

    /** What to show when there is no nicer label — the number itself will do. */
    val label: String get() = accountMsisdn ?: "Waiting for a number"
}
