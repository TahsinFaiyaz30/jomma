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
     * Which SIM this number's SMS arrives on, when the phone has more than one
     * and both carry the same provider.
     *
     * Null in the ordinary case, which is one account per provider: the sender
     * name already identifies it and asking about SIM slots would be a question
     * with one possible answer. Only set when two pairings would otherwise be
     * indistinguishable.
     */
    val subscriptionId: Int? = null,

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
