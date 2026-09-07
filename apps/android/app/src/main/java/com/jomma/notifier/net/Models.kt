package com.jomma.notifier.net

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/** Wire shapes for the device API. Mirrors docs/api.md. */

@Serializable
data class CaptureItem(
    @SerialName("local_id") val localId: String,
    val source: String,
    @SerialName("package") val pkg: String? = null,
    val raw: String,
    @SerialName("captured_at") val capturedAt: String? = null,
)

@Serializable
data class CaptureBatch(val captures: List<CaptureItem>)

@Serializable
data class CaptureResult(
    @SerialName("local_id") val localId: String,
    /**
     * accepted | duplicate | unparsed | filtered — all four mean "stop
     * retrying". `filtered` is a message the account's capture settings said not
     * to keep; it is reported rather than silently dropped precisely so the
     * queue can clear it instead of resending it forever.
     */
    val status: String,
    @SerialName("trx_id") val trxId: String? = null,
)

@Serializable
data class CaptureResponse(
    val results: List<CaptureResult> = emptyList(),
    @SerialName("server_time") val serverTime: String? = null,
)

@Serializable
data class HeartbeatRequest(
    val battery: Int? = null,
    val charging: Boolean? = null,
    val network: String? = null,
    @SerialName("queue_depth") val queueDepth: Int? = null,
    val permissions: Map<String, Boolean>? = null,
    @SerialName("app_version") val appVersion: String? = null,

    /**
     * The SIMs in this phone, so the dashboard can offer them.
     *
     * Sent on every beat rather than answered on request: the dashboard needs
     * them while somebody is adding an account, and a phone in a drawer cannot
     * be asked a question at the moment a browser thinks of one. A beat old is
     * fine for a list that only changes when the tray is opened.
     *
     * Null, not empty, when the permission has not been granted — the server
     * tells those apart, because "no SIMs in this phone" and "this app never
     * looked" call for different words on the screen.
     */
    val sims: List<SimReport>? = null,

    /**
     * Whether this phone is reporting for this business at all.
     *
     * Sent so the dashboard can say "the phone has paused this" instead of
     * showing a merchant a device that has simply gone quiet — the two look
     * identical from the server otherwise, and only one of them is a problem.
     */
    @SerialName("sending_enabled") val sendingEnabled: Boolean? = null,
)

/**
 * One SIM, in the wire shape the server's `simCardSchema` accepts.
 *
 * A separate type from `SimCard` on purpose. That one is what the app knows
 * about a SIM; this is what it is willing to say about it, in snake_case,
 * carrying nothing extra. Keeping them apart means adding a field the app finds
 * useful does not silently start sending it.
 */
@Serializable
data class SimReport(
    @SerialName("subscription_id") val subscriptionId: Int,
    @SerialName("slot_index") val slotIndex: Int,
    @SerialName("carrier_name") val carrierName: String,
    @SerialName("display_name") val displayName: String,
    val msisdn: String? = null,
    @SerialName("number_source") val numberSource: String? = null,
    @SerialName("network_generation") val networkGeneration: String,
)

@Serializable
data class DeviceCommand(
    val type: String,
    val since: String? = null,

    /**
     * For `add_account`: where to redeem the number that was chosen on the
     * dashboard.
     *
     * A pairing URL and never a token. The phone claims it exactly as it claims
     * a scanned QR, so the credential is issued to whoever is holding the
     * handset over a path that is already single-use, expiring and rate
     * limited — rather than pushed down this channel and hoped about.
     */
    @SerialName("pair_url") val pairUrl: String? = null,
    val msisdn: String? = null,
    val provider: String? = null,
)

/**
 * What this number keeps besides incoming Send Money.
 *
 * The account owns these, not the phone — the dashboard edits the same values.
 * They ride down on every heartbeat so a phone that has been offline comes back
 * in step with no reconciliation.
 *
 * Deliberately no switch for incoming Send Money. The server will only ever
 * match that type, so a toggle for it would be a toggle that stops payments
 * being recognised.
 *
 * Defaults are `false` so an older build, or a response from a server that has
 * not been updated yet, reads as "keep only what pays for orders".
 */
@Serializable
data class CaptureSettings(
    @SerialName("cash_in") val cashIn: Boolean = false,
    val outgoing: Boolean = false,
    val other: Boolean = false,
)

@Serializable
data class HeartbeatResponse(
    val ok: Boolean = true,
    val commands: List<DeviceCommand> = emptyList(),
    val capture: CaptureSettings? = null,
    @SerialName("server_time") val serverTime: String? = null,
)

@Serializable
data class SettingsResponse(
    val ok: Boolean = true,
    val capture: CaptureSettings = CaptureSettings(),
)

@Serializable
data class RotateResponse(
    @SerialName("device_token") val deviceToken: String,
)

@Serializable
data class DeviceEventRequest(
    val kind: String,
    val detail: String? = null,
)

@Serializable
data class PairRequest(
    val code: String,
    /**
     * What this phone calls itself, so the dashboard does not have to guess.
     *
     * The operator generating a QR has not met the device; "SM-A155F" is a
     * better starting point than anything they would type, and it can be
     * renamed afterwards. Cosmetic only — nothing is identified by it.
     */
    @SerialName("device_name") val deviceName: String? = null,
)

@Serializable
data class ProvisionAccount(val msisdn: String, val provider: String)

@Serializable
data class ProvisionResponse(
    @SerialName("device_token") val deviceToken: String,
    @SerialName("device_id") val deviceId: String,
    val account: ProvisionAccount,
)

/**
 * What the dashboard encodes into the provisioning QR: `https://host/pair/CODE`.
 *
 * A URL and not JSON, because a general-purpose QR scanner can open a URL and
 * can do nothing at all with JSON except show it to whoever is looking. The
 * server URL falls out of the same string, so there is nothing else to carry.
 *
 * Nothing legible is in it — no token prefix, no device id, no account number.
 * A scanner that displays the target shows a host and an opaque code.
 */
data class PairingLink(val serverUrl: String, val code: String) {

    /** Just the host, for asking someone whether they meant this server. */
    val host: String get() = serverUrl.removePrefix("https://")

    companion object {
        private const val PATH = "/pair/"

        /**
         * Parses either entry point into the same thing.
         *
         * The app's own scanner hands over the decoded QR text; an App Link
         * hands over the tapped URI. Both are the same URL, so both come here
         * and there is one definition of what a pairing link is.
         */
        fun parse(raw: String): PairingLink? {
            val uri = runCatching { java.net.URI(raw.trim()) }.getOrNull() ?: return null

            /*
             * https only. A pairing code is a bearer credential for one
             * exchange, and http would hand it to anyone on the same café
             * wi-fi. Refusing here also means a QR that has been tampered with
             * to downgrade the scheme simply fails to parse.
             */
            if (!uri.scheme.equals("https", ignoreCase = true)) return null

            val host = uri.host?.takeIf { it.isNotBlank() } ?: return null
            val path = uri.path ?: return null
            if (!path.startsWith(PATH)) return null

            val code = path.removePrefix(PATH).trim('/')
            if (code.isEmpty() || !code.all { it.isLetterOrDigit() || it == '-' || it == '_' }) {
                return null
            }

            val port = if (uri.port == -1) "" else ":${uri.port}"
            return PairingLink(serverUrl = "https://$host$port", code = code)
        }
    }
}
