# R8 rules for the release build.
#
# Deliberately almost empty. Every library here ships its own consumer rules —
# ML Kit, CameraX, Room, OkHttp and kotlinx.serialization all bundle what they
# need — so anything added by hand is either redundant or is papering over a
# real reflection bug. Rules copied from a blog post are how an app ends up
# shipping unminified.
#
# `build.gradle.kts` has always pointed at this file. It did not exist, so
# `assembleRelease` failed outright with "Supplied proguard configuration does
# not exist" and the release build could never be produced at all.

# ML Kit's components, which it finds by name rather than by reference.
#
# `AndroidManifest.xml` lists them as <meta-data> *string values* under
# MlKitComponentDiscoveryService:
#
#     com.google.mlkit.common.internal.CommonComponentRegistrar
#     com.google.mlkit.vision.barcode.internal.BarcodeRegistrar
#     com.google.mlkit.vision.common.internal.VisionCommonRegistrar
#
# R8 cannot follow a class name that exists only as a string, so it removed
# them — and with R8's full mode, on by default since AGP 8, it also renames
# anything it does keep, which breaks the lookup just as thoroughly.
#
# The result was not a build error. `BarcodeScanning.getClient` found no
# registered components and dereferenced null, so the scanner crashed the app
# the instant it opened — in release builds only. Debug builds are not
# minified, which is why this survived testing.
#
# `-keep` rather than `-keepnames`: the constructor is invoked reflectively, so
# the class needs its name *and* its no-arg constructor intact.
-keep class * implements com.google.firebase.components.ComponentRegistrar {
    <init>();
}

# Wire models are reflected over by kotlinx.serialization's generated
# serializers. The plugin's own rules keep the serializer classes; this keeps
# the `Companion.serializer()` accessor R8 cannot see being called through the
# generated code.
-keepclassmembers class com.jomma.notifier.net.** {
    *** Companion;
}
-keepclasseswithmembers class com.jomma.notifier.net.** {
    kotlinx.serialization.KSerializer serializer(...);
}

# Entry points the system instantiates by name from the manifest. R8 keeps
# manifest-declared components already; these are here because losing one fails
# silently at runtime on a device in another room rather than at build time,
# and this app's whole job is to not go quiet.
-keep class com.jomma.notifier.capture.NotificationListener { *; }
-keep class com.jomma.notifier.capture.SmsReceiver { *; }
-keep class com.jomma.notifier.service.NotifierService { *; }
-keep class com.jomma.notifier.service.BootReceiver { *; }

# WorkManager instantiates workers reflectively from a class name it persisted,
# so a rename between versions has to fail loudly rather than silently stop the
# heartbeat.
-keep class com.jomma.notifier.work.** extends androidx.work.ListenableWorker { *; }
