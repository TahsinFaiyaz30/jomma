package com.jomma.notifier.data

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase

@Database(entities = [Capture::class], version = 1, exportSchema = true)
abstract class JommaDatabase : RoomDatabase() {

    abstract fun captureDao(): CaptureDao

    companion object {
        @Volatile
        private var instance: JommaDatabase? = null

        fun get(context: Context): JommaDatabase =
            instance ?: synchronized(this) {
                instance ?: Room.databaseBuilder(
                    context.applicationContext,
                    JommaDatabase::class.java,
                    "jomma.db",
                )
                    // Never destructive. An unsent capture is money nobody knows
                    // about yet; losing one to a schema migration is not an
                    // acceptable trade for convenience.
                    .build()
                    .also { instance = it }
            }
    }
}
