-- The phone becomes a thing paired to a business rather than to a number.
--
-- Drizzle generated this as a bare `ADD COLUMN business_id uuid NOT NULL`,
-- which cannot run on a table that already has rows -- every existing device
-- would need a value the statement does not supply, and the migration fails
-- with a not-null violation on a deployment that has ever paired a phone. So it
-- is written out here in the three steps that actually work: add it nullable,
-- fill it in from what each device is already attached to, then tighten it.
--
-- Every existing device hangs off a receiving account, and every receiving
-- account already carries its business, so the backfill is exact rather than a
-- guess. A row that somehow has no account left would be a device belonging to
-- nothing, and the NOT NULL below is what refuses to carry that forward
-- silently.

ALTER TABLE "devices" ALTER COLUMN "receiving_account_id" DROP NOT NULL;--> statement-breakpoint

ALTER TABLE "devices" ADD COLUMN "business_id" uuid;--> statement-breakpoint

UPDATE "devices" AS d
   SET "business_id" = ra."business_id"
  FROM "receiving_accounts" AS ra
 WHERE ra."id" = d."receiving_account_id"
   AND d."business_id" IS NULL;--> statement-breakpoint

ALTER TABLE "devices" ALTER COLUMN "business_id" SET NOT NULL;--> statement-breakpoint

ALTER TABLE "devices" ADD CONSTRAINT "devices_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

CREATE INDEX "ix_devices_business" ON "devices" USING btree ("business_id","status");
