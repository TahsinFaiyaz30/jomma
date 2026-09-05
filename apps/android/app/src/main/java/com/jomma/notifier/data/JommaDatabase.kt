package com.jomma.notifier.data

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase

@Database(entities = [Capture::class], version = 2, exportSchema = true)
abstract class JommaDatabase : RoomDatabase() {

    abstract fun captureDao(): CaptureDao

    companion object {
        @Volatile
        private var instance: JommaDatabase? = null

        /**
         * Adds `outcome`, so the Log screen can tell an accepted capture from one
         * the capture settings filtered out.
         *
         * Written by hand rather than taking `fallbackToDestructiveMigration`.
         * The table can hold captures that have not reached the server yet, and
         * each of those is money nobody knows about — dropping the table to
         * avoid writing one ALTER is not a trade worth making.
         */
        private val MIGRATION_1_2 = object : Migration(1, 2) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE captures ADD COLUMN outcome TEXT")
            }
        }

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
                    .addMigrations(MIGRATION_1_2)
                    .build()
                    .also { instance = it }
            }
    }
}
