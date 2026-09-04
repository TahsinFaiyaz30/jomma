ALTER TABLE "apps" ADD COLUMN "allowed_redirect_hosts" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_intents" ADD COLUMN "return_url" text;--> statement-breakpoint
ALTER TABLE "payment_intents" ADD COLUMN "cancel_url" text;