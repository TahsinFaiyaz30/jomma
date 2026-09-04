CREATE TYPE "public"."refund_reason" AS ENUM('overpaid', 'cancel_order', 'other');--> statement-breakpoint
CREATE TYPE "public"."refund_request_status" AS ENUM('open', 'acknowledged', 'resolved', 'declined');--> statement-breakpoint
ALTER TYPE "public"."audit_action" ADD VALUE 'intent.refund_requested' BEFORE 'payment.captured';--> statement-breakpoint
ALTER TYPE "public"."webhook_event_type" ADD VALUE 'payment.refund_requested' BEFORE 'account.degraded';--> statement-breakpoint
CREATE TABLE "refund_requests" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"intent_id" uuid NOT NULL,
	"reason" "refund_reason" NOT NULL,
	"status" "refund_request_status" DEFAULT 'open' NOT NULL,
	"amount_cents" integer,
	"note" text,
	"contact_msisdn" text,
	"resolved_at" timestamp with time zone,
	"resolved_by" uuid,
	"resolution_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "refund_requests" ADD CONSTRAINT "refund_requests_intent_id_payment_intents_id_fk" FOREIGN KEY ("intent_id") REFERENCES "public"."payment_intents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_refund_requests_intent" ON "refund_requests" USING btree ("intent_id");--> statement-breakpoint
CREATE INDEX "ix_refund_requests_open" ON "refund_requests" USING btree ("status","created_at");