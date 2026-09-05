ALTER TABLE "receiving_accounts" ADD COLUMN "capture_cash_in" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "receiving_accounts" ADD COLUMN "capture_outgoing" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "receiving_accounts" ADD COLUMN "capture_other" boolean DEFAULT false NOT NULL;