package com.jomma.notifier.net

import android.content.Context
import com.jomma.notifier.data.Prefs
import java.io.IOException
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody

/**
 * The HTTP client.
 *
 * Deliberately small: capture, heartbeat, event, provision. No interceptors that
 * log bodies — messages contain buyer phone numbers and this device is treated
 * as holding customer data.
 */
class JommaApi(context: Context) {

    private val prefs = Prefs.get(context)

    private val client = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .writeTimeout(30, TimeUnit.SECONDS)
        .retryOnConnectionFailure(true)
        .build()

    private val json = Json {
        ignoreUnknownKeys = true
        encodeDefaults = false
    }

    sealed interface Result<out T> {
        data class Ok<T>(val value: T) : Result<T>
        /** The token is gone. The app must stop and ask to be re-provisioned. */
        data object Revoked : Result<Nothing>
        data class Failed(val message: String, val retryable: Boolean) : Result<Nothing>
    }

    suspend fun sendCaptures(batch: CaptureBatch): Result<CaptureResponse> =
        post("/device/v1/capture", json.encodeToString(CaptureBatch.serializer(), batch)) { body ->
            json.decodeFromString(CaptureResponse.serializer(), body)
        }

    suspend fun heartbeat(request: HeartbeatRequest): Result<HeartbeatResponse> =
        post("/device/v1/heartbeat", json.encodeToString(HeartbeatRequest.serializer(), request)) { body ->
            json.decodeFromString(HeartbeatResponse.serializer(), body)
        }

    /**
     * Swaps this device's token, using the one it currently holds.
     *
     * Called when a heartbeat comes back carrying `rotate_token`. The old token
     * stays valid right up until this succeeds, so a failed rotation leaves the
     * device working rather than locked out.
     */
    suspend fun rotateToken(): Result<RotateResponse> =
        post("/device/v1/rotate", "{}") { body ->
            json.decodeFromString(RotateResponse.serializer(), body)
        }

    suspend fun reportEvent(kind: String, detail: String? = null): Result<Unit> =
        post(
            "/device/v1/events",
            json.encodeToString(DeviceEventRequest.serializer(), DeviceEventRequest(kind, detail)),
        ) { }

    /**
     * The one call made without a device token, because there is not one yet.
     * On success the credentials are stored and the device is live.
     */
    suspend fun provision(baseUrl: String, deviceId: String, token: String): Result<ProvisionResponse> =
        withContext(Dispatchers.IO) {
            val payload = json.encodeToString(
                ProvisionRequest.serializer(),
                ProvisionRequest(deviceId, token),
            )
            val request = Request.Builder()
                .url("${baseUrl.trimEnd('/')}/device/v1/provision")
                .post(payload.toRequestBody(JSON_MEDIA))
                .build()

            execute(request) { body -> json.decodeFromString(ProvisionResponse.serializer(), body) }
        }

    private suspend fun <T> post(
        path: String,
        payload: String,
        parse: (String) -> T,
    ): Result<T> = withContext(Dispatchers.IO) {
        val baseUrl = prefs.serverUrl
        val token = prefs.deviceToken
        val deviceId = prefs.deviceId

        if (baseUrl.isNullOrBlank() || token.isNullOrBlank() || deviceId.isNullOrBlank()) {
            return@withContext Result.Failed("Device is not provisioned", retryable = false)
        }

        val request = Request.Builder()
            .url("${baseUrl.trimEnd('/')}$path")
            .header("Authorization", "Bearer $token")
            .header("X-Device-Id", deviceId)
            .post(payload.toRequestBody(JSON_MEDIA))
            .build()

        execute(request, parse)
    }

    private fun <T> execute(request: Request, parse: (String) -> T): Result<T> =
        try {
            client.newCall(request).execute().use { response ->
                val body = response.body?.string().orEmpty()
                when {
                    response.isSuccessful -> Result.Ok(parse(body))

                    // Revoked or re-provisioned elsewhere. Retrying forever would
                    // just hammer the endpoint; the app shows a re-provision
                    // screen instead of failing silently.
                    response.code == 401 -> {
                        prefs.revoked = true
                        Result.Revoked
                    }

                    // 4xx other than 401 is our bug, not a transient fault.
                    response.code in 400..499 ->
                        Result.Failed("HTTP ${response.code}", retryable = false)

                    else -> Result.Failed("HTTP ${response.code}", retryable = true)
                }
            }
        } catch (error: IOException) {
            Result.Failed(error.message ?: "Network error", retryable = true)
        } catch (error: Exception) {
            Result.Failed(error.message ?: "Unexpected error", retryable = false)
        }

    companion object {
        private val JSON_MEDIA = "application/json; charset=utf-8".toMediaType()
    }
}
