package com.jomma.notifier.data

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import kotlinx.coroutines.flow.Flow

@Dao
interface CaptureDao {

    /**
     * Ignores a duplicate `raw`.
     *
     * Notification and SMS are captured deliberately in parallel and often carry
     * byte-identical text. The server deduplicates properly on `trx_id`; this
     * just avoids queueing the same string twice from one device. When the two
     * differ at all, both are sent — the server decides.
     */
    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun insert(capture: Capture): Long

    @Query("SELECT * FROM captures WHERE sent = 0 ORDER BY capturedAt ASC LIMIT :limit")
    suspend fun pending(limit: Int = 200): List<Capture>

    @Query("SELECT COUNT(*) FROM captures WHERE sent = 0")
    suspend fun pendingCount(): Int

    @Query("SELECT COUNT(*) FROM captures WHERE sent = 0")
    fun pendingCountFlow(): Flow<Int>

    @Query("SELECT * FROM captures ORDER BY capturedAt DESC LIMIT :limit")
    fun recent(limit: Int = 200): Flow<List<Capture>>

    @Query("SELECT MAX(capturedAt) FROM captures")
    fun lastCaptureAtFlow(): Flow<Long?>

    @Query("SELECT COUNT(*) FROM captures WHERE capturedAt >= :since")
    fun countSinceFlow(since: Long): Flow<Int>

    @Query("UPDATE captures SET sent = 1, sentAt = :at, lastError = NULL WHERE localId IN (:ids)")
    suspend fun markSent(ids: List<String>, at: Long = System.currentTimeMillis())

    @Query("UPDATE captures SET attempts = attempts + 1, lastError = :error WHERE localId IN (:ids)")
    suspend fun markFailed(ids: List<String>, error: String)

    /**
     * Retention. Sent captures are kept for 30 days for debugging and then
     * pruned; unsent ones are never deleted, however old.
     */
    @Query("DELETE FROM captures WHERE sent = 1 AND sentAt IS NOT NULL AND sentAt < :before")
    suspend fun pruneSentBefore(before: Long): Int
}
