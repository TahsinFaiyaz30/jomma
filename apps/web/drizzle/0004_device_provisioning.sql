DROP INDEX "ux_devices_token_prefix";--> statement-breakpoint
ALTER TABLE "devices" ALTER COLUMN "token_prefix" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "devices" ALTER COLUMN "token_hash" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "devices" ALTER COLUMN "status" SET DEFAULT 'pending';--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "provisioning_hash" text;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "provisioning_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "provisioned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "token_issued_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "ux_devices_token_prefix" ON "devices" USING btree ("token_prefix") WHERE token_prefix is not null;
