ALTER TABLE "devices" ADD COLUMN "sims" jsonb;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "sims_reported_at" timestamp with time zone;