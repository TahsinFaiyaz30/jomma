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
)

@Serializable
data class DeviceCommand(
    val type: String,
    val since: String? = null,
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
