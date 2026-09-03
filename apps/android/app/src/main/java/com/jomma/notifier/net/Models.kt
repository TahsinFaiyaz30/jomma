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
    /** accepted | duplicate | unparsed — all three mean "stop retrying". */
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

@Serializable
data class HeartbeatResponse(
    val ok: Boolean = true,
    val commands: List<DeviceCommand> = emptyList(),
    @SerialName("server_time") val serverTime: String? = null,
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
data class ProvisionRequest(
    @SerialName("device_id") val deviceId: String,
    @SerialName("provisioning_token") val provisioningToken: String,
)

@Serializable
data class ProvisionAccount(val msisdn: String, val provider: String)

@Serializable
data class ProvisionResponse(
    @SerialName("device_token") val deviceToken: String,
    @SerialName("device_id") val deviceId: String,
    val account: ProvisionAccount,
)

/** What the dashboard encodes into the provisioning QR. */
@Serializable
data class ProvisioningPayload(
    val url: String,
    val token: String,
    @SerialName("device_id") val deviceId: String,
    @SerialName("expires_at") val expiresAt: String? = null,
)
