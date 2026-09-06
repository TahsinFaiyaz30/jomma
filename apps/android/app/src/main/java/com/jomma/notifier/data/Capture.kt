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
    indices = [
        Index(value = ["sent", "capturedAt"]),
        Index(value = ["deviceId", "sent"]),
        // Unique on the message *within a number*, not globally. Two SIMs on one
        // phone can legitimately receive the same text — an identical amount to
        // two accounts in the same minute — and a global unique index would
        // silently drop the second one, which is money nobody would know about.
        Index(value = ["deviceId", "raw"], unique = true),
    ],
)
data class Capture(
    @PrimaryKey val localId: String = UUID.randomUUID().toString(),
    /**
     * Which pairing this belongs to, and therefore which token reports it.
     *
     * Decided when the message is captured rather than when the queue is
     * flushed: attribution depends on what arrived — the sender, the app that
     * posted the notification, the SIM it came in on — and none of that is
     * still available later.
     */
    val deviceId: String,
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
    /**
     * What the server did with it: accepted | duplicate | unparsed | filtered.
     *
     * Kept because `sent` alone cannot answer the question the Log screen exists
     * to answer. A message the account's capture settings excluded is
     * acknowledged and dequeued exactly like an accepted one, and without this
     * the log would show it as "sent" while it appears nowhere in the dashboard
     * — which reads as a delivery bug and is not one.
     *
     * Null on rows written before this column existed, and on anything still
     * queued.
     */
    val outcome: String? = null,
)
