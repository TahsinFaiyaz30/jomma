package com.jomma.notifier.capture

import android.content.Context
import android.net.Uri
import androidx.annotation.OptIn
import androidx.camera.core.ExperimentalGetImage
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import com.google.mlkit.vision.barcode.BarcodeScanner
import com.google.mlkit.vision.barcode.BarcodeScannerOptions
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.common.InputImage
import java.io.IOException
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlinx.coroutines.suspendCancellableCoroutine

/**
 * QR decoding, for both ways a provisioning code can arrive.
 *
 * A camera frame and a photo out of the gallery are the same problem to ML Kit —
 * both become an `InputImage` and go through one decoder. That is the reason
 * this replaced zxing: the image path was not a second feature to build, it was
 * three lines away from the first one.
 *
 * QR only. Restricting the format is not tidiness — it is most of the speed,
 * because the detector stops looking for the dozen other symbologies it
 * supports, and it means a barcode on a packet on the desk cannot be mistaken
 * for a provisioning code.
 */
object QrDecoder {

    private val OPTIONS = BarcodeScannerOptions.Builder()
        .setBarcodeFormats(Barcode.FORMAT_QR_CODE)
        .build()

    fun newScanner(): BarcodeScanner = BarcodeScanning.getClient(OPTIONS)

    /**
     * Reads a QR out of an image the user picked.
     *
     * Returns null when there is no QR in it, which is an ordinary outcome and
     * not an error — people pick the wrong screenshot. Throws only if the image
     * itself could not be opened.
     */
    @Throws(IOException::class)
    suspend fun decodeImage(context: Context, uri: Uri): String? {
        val scanner = newScanner()
        return try {
            val input = InputImage.fromFilePath(context, uri)
            scanner.process(input).await().firstNotNullOfOrNull { it.rawValue }
        } finally {
            // Holds a native detector. Leaking one per pick would be a slow leak
            // in the one screen a user may retry several times.
            scanner.close()
        }
    }

    /**
     * A CameraX analyser that reports the first QR it sees in each frame.
     *
     * `onFound` can fire many times for one physical code — the camera keeps
     * delivering frames while it is still in view. Deduplicating is the caller's
     * job, because only the caller knows whether a second read is a mistake or a
     * deliberate re-scan.
     */
    @OptIn(ExperimentalGetImage::class)
    fun analyzer(scanner: BarcodeScanner, onFound: (String) -> Unit): ImageAnalysis.Analyzer =
        ImageAnalysis.Analyzer { proxy: ImageProxy ->
            val image = proxy.image
            if (image == null) {
                proxy.close()
                return@Analyzer
            }

            scanner.process(InputImage.fromMediaImage(image, proxy.imageInfo.rotationDegrees))
                .addOnSuccessListener { codes ->
                    codes.firstNotNullOfOrNull { it.rawValue }?.let(onFound)
                }
                // Unconditional. An unclosed ImageProxy stalls the whole
                // analysis pipeline at the backpressure limit, so a single
                // failed frame would freeze the preview for good.
                .addOnCompleteListener { proxy.close() }
        }
}

/**
 * `Task<T>` as a suspend function.
 *
 * ML Kit returns Play Services `Task`s. `kotlinx-coroutines-play-services` does
 * exactly this, and is not worth a dependency for one call site.
 */
private suspend fun <T> com.google.android.gms.tasks.Task<T>.await(): T =
    suspendCancellableCoroutine { continuation ->
        addOnSuccessListener { continuation.resume(it) }
        addOnFailureListener { continuation.resumeWithException(it) }
        addOnCanceledListener { continuation.cancel() }
    }
