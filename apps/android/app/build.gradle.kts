plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.ksp)
}

android {
    namespace = "com.jomma.notifier"
    compileSdk = 37

    defaultConfig {
        applicationId = "com.jomma.notifier"
        minSdk = 26
        targetSdk = 37
        versionCode = 1
        versionName = "1.0.0"

        /*
         * The host whose `/pair/…` links this build is allowed to open.
         *
         * Android App Links are verified against a literal host in the manifest,
         * so it cannot be discovered at runtime — which for self-hosted software
         * means it is a build input. Override it per deployment:
         *
         *     ./gradlew assembleRelease -PjommaHost=pay.yourshop.com
         *
         * and publish the APK's signing fingerprint at
         * `https://<that host>/.well-known/assetlinks.json` by setting
         * ANDROID_CERT_SHA256 on the server. Both halves have to agree or
         * Android quietly declines to verify and links open in a browser.
         */
        manifestPlaceholders["jommaHost"] =
            (project.findProperty("jommaHost") as String?) ?: "jomma-web.onrender.com"
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")

            /*
             * Real phones only.
             *
             * ML Kit's bundled detector is a native library shipped once per
             * ABI at roughly 5 MB each, and it dominates the APK. Half of that
             * is x86 and x86_64, which exist for emulators — no phone anyone
             * will point at a bKash notification runs them.
             *
             * This is an APK people sideload, not a Play bundle that gets split
             * per device, so nothing else strips them. Debug builds keep every
             * ABI so the emulator still works.
             */
            ndk {
                abiFilters += listOf("arm64-v8a", "armeabi-v7a")
            }
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    // AGP 9 provides Kotlin support itself — no kotlin-android plugin, and
    // jvmTarget follows compileOptions.
    buildFeatures {
        compose = true
        // AGP 9 stopped generating BuildConfig by default. The heartbeat reports
        // app_version from it, which is how the dashboard shows which build a
        // phone is running.
        buildConfig = true
    }

    packaging {
        resources.excludes += "/META-INF/{AL2.0,LGPL2.1}"
    }
}

/*
 * Nothing here ships message contents anywhere except the Jomma server.
 * No analytics, no crash reporter. docs/android.md treats this device as
 * holding customer data, because it does.
 */
dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.lifecycle.service)
    implementation(libs.androidx.activity.compose)

    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.ui.tooling.preview)
    implementation(libs.androidx.compose.material3)
    // Material Symbols. The whole set, so a screen can use the right icon
    // rather than the nearest one in the core subset.
    implementation(libs.androidx.compose.material.icons.extended)

    implementation(libs.androidx.room.runtime)
    implementation(libs.androidx.room.ktx)
    ksp(libs.androidx.room.compiler)

    implementation(libs.androidx.work.runtime.ktx)
    implementation(libs.androidx.security.crypto)

    implementation(libs.okhttp)
    implementation(libs.kotlinx.serialization.json)

    /*
     * Provisioning QR.
     *
     * CameraX for the preview and ML Kit for the decode, replacing
     * zxing-android-embedded. Three reasons, in order of how much they matter:
     *
     *   1. ML Kit reads one QR out of a *picture* as readily as out of a camera
     *      frame, which is what makes "scan from an image" a few lines rather
     *      than a second decoder. The dashboard QR is usually on a screen next
     *      to the phone, but often enough it is in a screenshot someone was
     *      sent, and there was no way to use that at all.
     *   2. It decodes damaged, angled and low-light codes far better, which on
     *      a cheap phone pointed at a laptop screen is the difference between
     *      scanning and giving up.
     *   3. zxing-android-embedded ships its own Activity with
     *      `screenOrientation="sensorLandscape"` hardcoded in its manifest, so
     *      opening the scanner slammed the phone into landscape and no runtime
     *      option could override it. That is gone with the library.
     */
    implementation(libs.androidx.camera.core)
    implementation(libs.androidx.camera.camera2)
    implementation(libs.androidx.camera.lifecycle)
    implementation(libs.androidx.camera.view)
    implementation(libs.mlkit.barcode.scanning)

    // Plain JVM tests. `PairingLink` is pure Kotlin on purpose so the rules
    // about what counts as a provisioning link can be tested without a device.
    testImplementation(libs.junit)
}
