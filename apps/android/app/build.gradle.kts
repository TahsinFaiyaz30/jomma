plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.ksp)
}

/*
 * Release signing.
 *
 * Read from Gradle properties so a keystore path and its passwords never enter
 * the repository. Put them in `~/.gradle/gradle.properties`, which is outside
 * the project and outside any sync folder:
 *
 *     jommaKeystore=C:/keys/jomma.jks
 *     jommaKeystorePassword=…
 *     jommaKeyAlias=jomma
 *     jommaKeyPassword=…
 *
 * Absent, `assembleRelease` still runs and produces an *unsigned* APK, which
 * Android will refuse to install. That used to be the silent end of the road:
 * the only build you could actually put on a phone was the debug one, and its
 * certificate is not the one you would publish in assetlinks.json. The check in
 * `printSigningFingerprint` below says so out loud instead.
 */
val keystorePath = project.findProperty("jommaKeystore") as String?
val keystoreFile = keystorePath?.let(::file)?.takeIf { it.exists() }

/*
 * The version, from the repository root `VERSION` file.
 *
 * One number for the whole product — web, packages and app — because they ship
 * together and a phone reporting a different version from the server it talks
 * to is a support conversation nobody can win. `docs/versioning.md` has the
 * rules; `pnpm version:set` is how it changes.
 *
 * Read rather than duplicated. This used to say `1.0.0` while every
 * package.json said `0.1.0`, and neither was right.
 */
val jommaVersion: String = rootProject.projectDir
    .resolveSibling("..")
    .let { generateSequence(rootProject.projectDir) { it.parentFile }.take(5) }
    .map { File(it, "VERSION") }
    .firstOrNull { it.isFile }
    ?.readText()
    ?.trim()
    ?: error("No VERSION file found above ${rootProject.projectDir}.")

/**
 * `1.4.2` becomes `10402`.
 *
 * Android needs a monotonically increasing integer, and it can never go
 * backwards for an installed app — a lower one is refused as a downgrade. This
 * mapping keeps ordering identical to semver ordering as long as minor and
 * patch stay below 100, which `scripts/version.mjs` enforces when it writes the
 * VERSION file.
 */
fun versionCodeOf(version: String): Int {
    // `substringBefore('-')` drops a pre-release suffix like `1.4.2-rc1`, which
    // shares a version code with the release it precedes. Splitting on '-' and
    // '.' together instead would leave only the major number.
    val parts = version.substringBefore('-').split('.').map { it.trim().toIntOrNull() ?: 0 }
    val major = parts.getOrElse(0) { 0 }
    val minor = parts.getOrElse(1) { 0 }
    val patch = parts.getOrElse(2) { 0 }
    return major * 10_000 + minor * 100 + patch
}

android {
    namespace = "com.jomma.notifier"
    compileSdk = 37

    signingConfigs {
        if (keystoreFile != null) {
            create("release") {
                storeFile = keystoreFile
                storePassword = project.findProperty("jommaKeystorePassword") as String?
                keyAlias = project.findProperty("jommaKeyAlias") as String?
                keyPassword = project.findProperty("jommaKeyPassword") as String?
            }
        }
    }

    defaultConfig {
        applicationId = "com.jomma.notifier"
        minSdk = 26
        targetSdk = 37
        versionCode = versionCodeOf(jommaVersion)
        versionName = jommaVersion

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
            if (keystoreFile != null) signingConfig = signingConfigs.getByName("release")

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

/**
 * Prints the SHA-256 fingerprint to put in `ANDROID_CERT_SHA256`.
 *
 *     ./gradlew :app:printSigningFingerprint
 *
 * This exists because the App Link half of provisioning fails *silently*
 * otherwise. Nothing errors: the server publishes an empty statement list,
 * Android declines to verify the domain, and a QR scanned with the camera app
 * opens a browser instead of the notifier. Working out that the cause was an
 * unset environment variable — and then that the value came from a keytool
 * invocation nobody remembers — is not a debugging session anyone should have.
 *
 * Prints the release certificate when a keystore is configured, and the debug
 * one otherwise, saying which. They are different keys: publishing the debug
 * fingerprint authorises only APKs built on this machine, which is fine while
 * testing and wrong for anything you hand to someone else.
 */
tasks.register("printSigningFingerprint") {
    group = "jomma"
    description = "SHA-256 of the signing certificate, for ANDROID_CERT_SHA256."

    val release = keystoreFile
    val releaseAlias = project.findProperty("jommaKeyAlias") as String?
    val releasePassword = project.findProperty("jommaKeystorePassword") as String?
    val debug = File(System.getProperty("user.home"), ".android/debug.keystore")
    val host = (project.findProperty("jommaHost") as String?) ?: "jomma-web.onrender.com"
    val javaHome = System.getProperty("java.home")

    doLast {
        val (store, alias, password, kind) =
            if (release != null) {
                listOf(release.absolutePath, releaseAlias ?: "", releasePassword ?: "", "release")
            } else {
                listOf(debug.absolutePath, "androiddebugkey", "android", "debug")
            }

        if (!File(store).exists()) {
            throw GradleException(
                "No keystore at $store. Set jommaKeystore in ~/.gradle/gradle.properties, " +
                    "or build a debug APK once to have Android create a debug keystore.",
            )
        }

        val output = providers.exec {
            commandLine(
                "$javaHome/bin/keytool", "-list", "-v",
                "-keystore", store, "-alias", alias,
                "-storepass", password, "-keypass", password,
            )
        }.standardOutput.asText.get()

        val fingerprint = output.lineSequence()
            .firstOrNull { it.trim().startsWith("SHA256:") }
            ?.substringAfter("SHA256:")
            ?.trim()
            ?: throw GradleException("keytool did not report a SHA-256 for alias '$alias'.")

        logger.lifecycle(
            """

            $kind signing certificate
            ────────────────────────────────────────────────────────────────
            ANDROID_CERT_SHA256=$fingerprint

            Set that on the server, then confirm it is being served:
              curl https://$host/.well-known/assetlinks.json

            The APK must be built for the same host:
              ./gradlew assembleRelease -PjommaHost=$host

            On the phone, `adb shell pm get-app-links com.jomma.notifier`
            should then report `verified` rather than `none`.
            """.trimIndent(),
        )
    }
}
