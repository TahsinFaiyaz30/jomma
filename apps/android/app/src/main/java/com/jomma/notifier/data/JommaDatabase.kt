package com.jomma.notifier.data

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase

@Database(entities = [Capture::class], version = 3, exportSchema = true)
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

        /**
         * Adds `deviceId`, so a queued capture knows which number it is for.
         *
         * Existing rows are stamped with the phone's one pairing, which is the
         * only number it can have been watching — the column exists precisely
         * because that stopped being true. Backfilled from prefs rather than
         * left null so nothing already queued is stranded without a route to
         * the server.
         *
         * The old global unique index on `raw` goes with it. Two SIMs can
         * receive the same text, and that index would have dropped the second
         * copy as a duplicate.
         */
        private fun migration2To3(context: Context) = object : Migration(2, 3) {
            override fun migrate(db: SupportSQLiteDatabase) {
                val existing = Prefs.get(context).pairings.firstOrNull()?.deviceId.orEmpty()

                db.execSQL("ALTER TABLE captures ADD COLUMN deviceId TEXT NOT NULL DEFAULT ''")
                db.execSQL("UPDATE captures SET deviceId = ?", arrayOf(existing))

                db.execSQL("DROP INDEX IF EXISTS index_captures_raw")
                db.execSQL(
                    "CREATE UNIQUE INDEX IF NOT EXISTS index_captures_deviceId_raw " +
                        "ON captures (deviceId, raw)",
                )
                db.execSQL(
                    "CREATE INDEX IF NOT EXISTS index_captures_deviceId_sent " +
                        "ON captures (deviceId, sent)",
                )
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
                    .addMigrations(MIGRATION_1_2, migration2To3(context))
                    .build()
                    .also { instance = it }
            }
    }
}
