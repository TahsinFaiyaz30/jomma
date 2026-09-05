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
