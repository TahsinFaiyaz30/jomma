package com.jomma.notifier.update

/**
 * How often to look for a new build.
 *
 * `Daily` is the default. This app is installed once on a phone that then sits
 * in a drawer watching for money, so a fix — the scanner crash in 1.1.1, say —
 * has no other way of reaching it. Weekly leaves a known-broken build running
 * for days; every launch is wasted effort on a device nobody opens.
 *
 * `Never` exists because an operator who deploys their own builds should be
 * able to say so, not have the app nagging about a release they deliberately
 * are not on.
 */
enum class UpdateInterval(val label: String, val millis: Long) {
    EveryLaunch("Every time the app opens", 0),
    Daily("Once a day", 24L * 60 * 60 * 1000),
    Weekly("Once a week", 7L * 24 * 60 * 60 * 1000),
    Monthly("Once a month", 30L * 24 * 60 * 60 * 1000),
    Never("Never", Long.MAX_VALUE);

    companion object {
        val DEFAULT = Daily

        fun from(name: String?): UpdateInterval =
            entries.firstOrNull { it.name == name } ?: DEFAULT
    }
}

/**
 * What a check found.
 *
 * `variant` matters: a phone running a debug build must be offered the debug
 * APK. Android refuses an update signed by a different key, and the two builds
 * are signed differently — offering the wrong one produces an install failure
 * with a message nobody can act on.
 */
data class AvailableUpdate(
    val version: String,
    val tag: String,
    val downloadUrl: String,
    val sizeBytes: Long,
    val notes: String,
    val variant: String,
) {
    val sizeLabel: String
        get() = if (sizeBytes <= 0) "unknown size" else "${sizeBytes / 1_048_576} MB"
}
