# kotlinx.serialization keeps its generated serializers via annotations.
-keepattributes *Annotation*, InnerClasses
-dontnote kotlinx.serialization.**
-keepclassmembers class com.jomma.notifier.net.** {
    *** Companion;
}
-keepclasseswithmembers class com.jomma.notifier.net.** {
    kotlinx.serialization.KSerializer serializer(...);
}
