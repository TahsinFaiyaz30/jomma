package com.jomma.notifier.ui

import android.Manifest
import android.content.pm.PackageManager
import android.util.Log
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.FlashlightOff
import androidx.compose.material.icons.outlined.FlashlightOn
import androidx.compose.material.icons.outlined.Image
import androidx.compose.material.icons.outlined.QrCodeScanner
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.RectangleShape
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.jomma.notifier.capture.QrDecoder
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

private const val TAG = "JommaScanner"

/**
 * The provisioning scanner.
 *
 * Two ways in, because the QR is not always in front of the camera. It is shown
 * in the dashboard on a laptop next to the phone — the usual case — but it is
 * just as often in a screenshot someone was sent, and before this there was no
 * way to use that at all short of displaying it on a second screen.
 *
 * Full-screen inside MainActivity rather than its own Activity. The old library
 * brought one along, hardcoded to landscape in its own manifest, and rotating
 * the phone to scan a code was the single most obviously broken thing in the
 * app.
 */
@Composable
fun ScannerScreen(onResult: (String) -> Unit, onDismiss: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    var granted by remember {
        mutableStateOf(
            ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) ==
                PackageManager.PERMISSION_GRANTED,
        )
    }
    var pickingImage by remember { mutableStateOf(false) }
    var notice by remember { mutableStateOf<String?>(null) }

    /*
     * One result, then nothing.
     *
     * The camera keeps delivering frames while the code is still in view, so a
     * successful scan fires repeatedly. Provisioning burns a one-time token —
     * the second call would come back "already used" and show a failure for a
     * scan that actually worked.
     */
    var handled by remember { mutableStateOf(false) }

    /*
     * The analyser is bound once and holds whichever lambda it was given, so a
     * plain capture would pin the first composition's `onResult` forever. It
     * happens to be harmless today because that lambda only touches stable
     * state, but "happens to be harmless" is not a property worth depending on
     * in the code path that provisions the device.
     */
    val latestResult by rememberUpdatedState(onResult)
    val deliver = remember {
        { value: String ->
            if (!handled) {
                handled = true
                latestResult(value)
            }
        }
    }

    val permissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { result ->
        granted = result
        // `NoCamera` already explains a refusal, in the middle of the screen.
        // Saying it again at the bottom is just two messages about one thing.
        if (result) notice = null
    }

    /*
     * Photo Picker, not READ_MEDIA_IMAGES.
     *
     * The user hands over exactly one image and the app never gets to see the
     * gallery. Asking for storage access to read one QR would be a much larger
     * permission than the job needs, on a device that already holds customer
     * data.
     */
    val imageLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.PickVisualMedia(),
    ) { uri ->
        if (uri == null) return@rememberLauncherForActivityResult

        pickingImage = true
        notice = null
        scope.launch {
            val outcome = withContext(Dispatchers.Default) {
                runCatching { QrDecoder.decodeImage(context, uri) }
            }
            pickingImage = false

            outcome
                .onSuccess { decoded ->
                    // Null is an ordinary outcome — people pick the wrong
                    // screenshot — and reads differently from a file that could
                    // not be opened at all, which is usually a format the
                    // decoder does not handle.
                    if (decoded == null) notice = "No QR code in that image."
                    else deliver(decoded)
                }
                .onFailure {
                    Log.w(TAG, "could not read the picked image", it)
                    notice = "That image could not be opened. Try a screenshot or a PNG."
                }
        }
    }

    LaunchedEffect(Unit) {
        if (!granted) permissionLauncher.launch(Manifest.permission.CAMERA)
    }

    Box(Modifier.fillMaxSize().background(Color.Black)) {
        if (granted) {
            CameraViewfinder(onQr = deliver)
            ScanReticle()
        } else {
            NoCamera(onGrant = { permissionLauncher.launch(Manifest.permission.CAMERA) })
        }

        Column(
            Modifier.align(Alignment.TopCenter).fillMaxWidth().padding(16.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = onDismiss) {
                    Icon(Icons.Outlined.Close, contentDescription = "Close", tint = Color.White)
                }
                Text(
                    "Scan the code from the Jomma dashboard",
                    color = Color.White,
                    style = MaterialTheme.typography.titleMedium,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.weight(1f),
                )
                // Balances the close button so the title sits centred.
                Spacer(Modifier.width(48.dp))
            }
        }

        Column(
            Modifier.align(Alignment.BottomCenter).fillMaxWidth().padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            notice?.let {
                Text(
                    it,
                    color = Color.White,
                    style = MaterialTheme.typography.bodyMedium,
                    textAlign = TextAlign.Center,
                )
            }

            FilledTonalButton(
                onClick = {
                    imageLauncher.launch(
                        PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly),
                    )
                },
                enabled = !pickingImage && !handled,
            ) {
                if (pickingImage) {
                    CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp)
                } else {
                    Icon(Icons.Outlined.Image, contentDescription = null)
                }
                Spacer(Modifier.width(8.dp))
                Text("Scan from an image")
            }
        }
    }
}

/**
 * CameraX preview with an ML Kit analyser bound to it.
 *
 * `KEEP_ONLY_LATEST` on purpose: a QR is a still object, so a backlog of stale
 * frames is worth nothing and only adds latency between pointing the phone and
 * seeing it work.
 */
@Composable
private fun CameraViewfinder(onQr: (String) -> Unit) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val previewView = remember { PreviewView(context) }
    var torchOn by remember { mutableStateOf(false) }
    var hasTorch by remember { mutableStateOf(false) }
    var camera by remember { mutableStateOf<androidx.camera.core.Camera?>(null) }

    DisposableEffect(lifecycleOwner) {
        val executor = ContextCompat.getMainExecutor(context)
        val scanner = QrDecoder.newScanner()
        val future = ProcessCameraProvider.getInstance(context)
        var provider: ProcessCameraProvider? = null

        future.addListener({
            val bound = runCatching {
                val cameraProvider = future.get().also { provider = it }

                val preview = Preview.Builder().build().apply {
                    surfaceProvider = previewView.surfaceProvider
                }

                val analysis = ImageAnalysis.Builder()
                    .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                    .build()
                    .apply { setAnalyzer(executor, QrDecoder.analyzer(scanner, onQr)) }

                cameraProvider.unbindAll()
                cameraProvider.bindToLifecycle(
                    lifecycleOwner,
                    CameraSelector.DEFAULT_BACK_CAMERA,
                    preview,
                    analysis,
                )
            }

            bound
                .onSuccess {
                    camera = it
                    hasTorch = it.cameraInfo.hasFlashUnit()
                }
                // A phone with no usable back camera, or one already held by
                // another app. The image path still works, so this must not take
                // the screen down with it.
                .onFailure { Log.e(TAG, "could not start the camera", it) }
        }, executor)

        onDispose {
            provider?.unbindAll()
            scanner.close()
        }
    }

    AndroidView(factory = { previewView }, modifier = Modifier.fillMaxSize())

    if (hasTorch) {
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.CenterEnd) {
            IconButton(
                onClick = {
                    torchOn = !torchOn
                    camera?.cameraControl?.enableTorch(torchOn)
                },
                modifier = Modifier.padding(end = 16.dp),
            ) {
                Icon(
                    if (torchOn) Icons.Outlined.FlashlightOn else Icons.Outlined.FlashlightOff,
                    contentDescription = if (torchOn) "Turn the torch off" else "Turn the torch on",
                    tint = Color.White,
                )
            }
        }
    }
}

/** Aiming guide. Decoding uses the whole frame — this only tells the eye where to point. */
@Composable
private fun ScanReticle() {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Box(
            Modifier
                .size(240.dp)
                .clip(RectangleShape)
                .background(Color.Transparent),
        ) {
            val corner = 32.dp
            val thickness = 3.dp
            @Composable
            fun bar(modifier: Modifier) = Box(modifier.background(Color.White))

            bar(Modifier.align(Alignment.TopStart).size(corner, thickness))
            bar(Modifier.align(Alignment.TopStart).size(thickness, corner))
            bar(Modifier.align(Alignment.TopEnd).size(corner, thickness))
            bar(Modifier.align(Alignment.TopEnd).size(thickness, corner))
            bar(Modifier.align(Alignment.BottomStart).size(corner, thickness))
            bar(Modifier.align(Alignment.BottomStart).size(thickness, corner))
            bar(Modifier.align(Alignment.BottomEnd).size(corner, thickness))
            bar(Modifier.align(Alignment.BottomEnd).size(thickness, corner))
        }
    }
}

/**
 * Camera declined, or unavailable.
 *
 * Not a dead end: reading the code out of a saved image needs no camera at all,
 * so the screen keeps working and says so.
 */
@Composable
private fun NoCamera(onGrant: () -> Unit) {
    Column(
        Modifier.fillMaxSize().padding(32.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Icon(
            Icons.Outlined.QrCodeScanner,
            contentDescription = null,
            tint = Color.White,
            modifier = Modifier.size(48.dp),
        )
        Spacer(Modifier.size(16.dp))
        Text(
            "Camera access is off",
            color = Color.White,
            style = MaterialTheme.typography.titleMedium,
        )
        Spacer(Modifier.size(8.dp))
        Text(
            "Grant it to point the phone at the code, or use a screenshot of it instead.",
            color = Color.White.copy(alpha = 0.75f),
            style = MaterialTheme.typography.bodyMedium,
            textAlign = TextAlign.Center,
        )
        Spacer(Modifier.size(16.dp))
        Button(onClick = onGrant) { Text("Allow camera") }
    }
}
