package com.jomma.notifier.data

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey
import java.util.UUID

/**
 * A captured message, on its way to the server.
 *
 * The ordering rule this exists to enforce, from docs/android.md:
 *
 *   1. Write to Room.
 *   2. Attempt the POST.
 *   3. Mark `sent` only on a 2xx.
 *
 * A capture that exists only in a variable is lost to a crash, a kill, or a
 * reboot. There is no code path in this app that holds one in memory.
 *
 * Nothing is parsed here. Parsing lives on the server, where a broken parser is
 * fixed by deploying rather than by shipping an APK to a phone in another room.
 */
@Entity(
    tableName = "captures",
    indices = [Index(value = ["sent", "capturedAt"]), Index(value = ["raw"], unique = true)],
)
data class Capture(
    @PrimaryKey val localId: String = UUID.randomUUID().toString(),
    /** notification | sms */
    val source: String,
    val pkg: String? = null,
    /** The message, verbatim. Never parsed on-device. */
    val raw: String,
    /** Device clock. The server treats this as display only. */
    val capturedAt: Long = System.currentTimeMillis(),
    val sent: Boolean = false,
    val attempts: Int = 0,
    val lastError: String? = null,
    val sentAt: Long? = null,
)
