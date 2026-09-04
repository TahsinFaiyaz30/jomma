package com.jomma.notifier.ui

import android.os.Build
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.dynamicDarkColorScheme
import androidx.compose.material3.dynamicLightColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.ProvidableCompositionLocal
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext

/**
 * Material 3 with dynamic colour.
 *
 * On Android 12+ the whole app takes its palette from the user's wallpaper —
 * Material You. Everything structural (surfaces, cards, the navigation bar,
 * buttons) uses Material colour roles so it re-tints automatically when the
 * wallpaper changes.
 *
 * Status colour is the deliberate exception. "Is it working?" has to read the
 * same on every phone, so those four are fixed rather than derived. A green
 * pulled from someone's wallpaper is not necessarily distinguishable from their
 * amber.
 */

private val BrandLight = lightColorScheme(
    primary = Color(0xFF4C662B),
    onPrimary = Color(0xFFFFFFFF),
    primaryContainer = Color(0xFFCDEDA3),
    onPrimaryContainer = Color(0xFF102000),
    secondary = Color(0xFF586249),
    secondaryContainer = Color(0xFFDCE7C8),
    tertiary = Color(0xFF386663),
    tertiaryContainer = Color(0xFFBCECE7),
)

private val BrandDark = darkColorScheme(
    primary = Color(0xFFB1D18A),
    onPrimary = Color(0xFF1F3701),
    primaryContainer = Color(0xFF354E16),
    onPrimaryContainer = Color(0xFFCDEDA3),
    secondary = Color(0xFFBFCBAD),
    secondaryContainer = Color(0xFF404A33),
    tertiary = Color(0xFFA0D0CB),
    tertiaryContainer = Color(0xFF1F4E4B),
)

/**
 * Status colours, one pair per state so they stay legible on both surfaces.
 * These intentionally do not participate in dynamic colour.
 */
data class StatusColors(
    val connected: Color,
    val onConnected: Color,
    val connectedContainer: Color,
    val degraded: Color,
    val onDegraded: Color,
    val degradedContainer: Color,
    val down: Color,
    val onDown: Color,
    val downContainer: Color,
)

private val LightStatus = StatusColors(
    connected = Color(0xFF276B3F),
    onConnected = Color(0xFFFFFFFF),
    connectedContainer = Color(0xFFB8F2C8),
    degraded = Color(0xFF8A5A00),
    onDegraded = Color(0xFFFFFFFF),
    degradedContainer = Color(0xFFFFDDB0),
    down = Color(0xFFB3261E),
    onDown = Color(0xFFFFFFFF),
    downContainer = Color(0xFFF9DEDC),
)

private val DarkStatus = StatusColors(
    connected = Color(0xFF7DDBA0),
    onConnected = Color(0xFF00391D),
    connectedContainer = Color(0xFF16512F),
    degraded = Color(0xFFF5BD62),
    onDegraded = Color(0xFF452B00),
    degradedContainer = Color(0xFF654100),
    down = Color(0xFFF2B8B5),
    onDown = Color(0xFF601410),
    downContainer = Color(0xFF8C1D18),
)

val LocalStatusColors: ProvidableCompositionLocal<StatusColors> =
    compositionLocalOf { LightStatus }

@Composable
fun JommaTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    /** Material You. Off means the brand palette above. */
    dynamicColor: Boolean = true,
    content: @Composable () -> Unit,
) {
    val context = LocalContext.current

    val scheme: ColorScheme = when {
        dynamicColor && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S ->
            if (darkTheme) dynamicDarkColorScheme(context) else dynamicLightColorScheme(context)

        darkTheme -> BrandDark
        else -> BrandLight
    }

    CompositionLocalProvider(LocalStatusColors provides if (darkTheme) DarkStatus else LightStatus) {
        MaterialTheme(
            colorScheme = scheme,
            content = content,
        )
    }
}
