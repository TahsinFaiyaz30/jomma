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
    val accountMsisdn: String,
    val provider: String,
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

    val pairedAt: Long = System.currentTimeMillis(),
    val lastHeartbeatAt: Long = 0,
) {
    /** Reporting works only once the dashboard has said yes and not since revoked. */
    val live: Boolean get() = !revoked && !awaitingApproval

    /** What to show when there is no nicer label — the number itself will do. */
    val label: String get() = accountMsisdn
}
