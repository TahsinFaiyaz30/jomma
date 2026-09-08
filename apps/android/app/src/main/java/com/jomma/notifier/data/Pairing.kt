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
     * The merchant this credential reports to.
     *
     * The unit everything here is really about. A phone pairs to a *business*
     * and then supplies it with what only a handset has — notifications, SMS,
     * the SIMs in the tray. The numbers are the business's, not the phone's.
     *
     * The server has always answered with this and the app used to discard it,
     * so a handset helping two shops could only show a list of numbers with
     * nothing saying which shop each was for, and no way to act on one shop
     * without touching the other.
     *
     * Null on a pairing made before this was stored. Backfilled on the next
     * heartbeat, which now carries it too, so an install that upgrades does not
     * have to be paired again.
     */
    val businessId: String? = null,
    val businessName: String? = null,
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

    /**
     * What to call the merchant on screen.
     *
     * Falls back rather than showing an empty row: a pairing from before the
     * name was stored is still a real pairing, and it will name itself on the
     * next beat.
     */
    val businessLabel: String get() = businessName ?: "This business"

    /**
     * The key to group by.
     *
     * Falls back to the device id so pairings from before the business was
     * stored each stand alone, rather than collapsing into one group called
     * null and offering to disable all of them together.
     */
    val businessKey: String get() = businessId ?: "device:$deviceId"
}

/**
 * One merchant this phone helps, and every credential it holds for them.
 *
 * The unit the screens work in. A phone pairs to a business and then supplies
 * it with what only a handset has — notifications, SMS, the SIMs in the tray —
 * so "which shop" is the first question every screen has to answer, and the
 * numbers hang off that answer rather than the other way round.
 *
 * Derived from the pairing list on every read, never stored, so it cannot fall
 * out of step with the credentials it describes.
 */
data class BusinessGroup(
    /** [Pairing.businessKey]. Stable across the pairings that share it. */
    val key: String,
    /** Null only for a pairing made before the business was stored. */
    val id: String?,
    val name: String,
    val pairings: List<Pairing>,
) {
    /** The numbers being watched for this merchant. */
    val wallets: List<Pairing> get() = pairings.filter { it.accountMsisdn != null }

    /**
     * Whether the phone is reporting for this merchant at all.
     *
     * True unless *every* pairing has been switched off, so a business is only
     * "disabled" when nothing is being sent for it. Half-off reads as on, which
     * is the honest answer: something is still being captured.
     */
    val enabled: Boolean get() = pairings.any { it.sendingEnabled }

    /** Waiting on somebody at the dashboard before anything can be captured. */
    val awaitingApproval: Boolean get() = pairings.all { it.awaitingApproval }

    val revoked: Boolean get() = pairings.all { it.revoked }

    companion object {
        /**
         * Groups pairings into the merchants they belong to.
         *
         * The single definition, shared by the store and the screens. Holding a
         * second, stored copy alongside the pairing list meant the two could
         * disagree — and they did: a screen handed pairings without the matching
         * group list showed no wallets at all, because the grouping it was
         * asked for had never been computed.
         *
         * Ordered by when the phone first paired to each, so the list does not
         * reshuffle as numbers are added.
         */
        fun from(pairings: List<Pairing>): List<BusinessGroup> = pairings
            .groupBy { it.businessKey }
            .map { (key, group) ->
                BusinessGroup(
                    key = key,
                    id = group.firstNotNullOfOrNull { it.businessId },
                    name = group.firstNotNullOfOrNull { it.businessName }
                        ?: group.first().businessLabel,
                    pairings = group,
                )
            }
            .sortedBy { group -> group.pairings.minOf { it.pairedAt } }
    }
}
