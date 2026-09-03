-- Adds 'pending' to device_status.
--
-- `ALTER TYPE ... ADD VALUE` cannot be used in the same transaction that adds
-- it, and drizzle's migrator runs every pending migration inside one
-- transaction, so the generated statement fails with
-- "unsafe use of new value". Recreating the type sidesteps that entirely: a
-- freshly created type has no such restriction.
ALTER TABLE "devices" ALTER COLUMN "status" DROP DEFAULT;--> statement-breakpoint
ALTER TYPE "public"."device_status" RENAME TO "device_status_old";--> statement-breakpoint
CREATE TYPE "public"."device_status" AS ENUM('pending', 'active', 'revoked');--> statement-breakpoint
ALTER TABLE "devices" ALTER COLUMN "status" TYPE "public"."device_status" USING "status"::text::"public"."device_status";--> statement-breakpoint
ALTER TABLE "devices" ALTER COLUMN "status" SET DEFAULT 'pending';--> statement-breakpoint
DROP TYPE "public"."device_status_old";
