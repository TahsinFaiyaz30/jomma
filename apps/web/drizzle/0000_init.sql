CREATE TYPE "public"."account_status" AS ENUM('active', 'degraded', 'disabled');--> statement-breakpoint
CREATE TYPE "public"."adapter_reliability" AS ENUM('primary', 'secondary', 'best_effort');--> statement-breakpoint
CREATE TYPE "public"."alert_severity" AS ENUM('critical', 'high', 'medium', 'low');--> statement-breakpoint
CREATE TYPE "public"."app_status" AS ENUM('active', 'suspended');--> statement-breakpoint
CREATE TYPE "public"."audit_action" AS ENUM('intent.created', 'intent.cancelled', 'intent.extended', 'intent.expired', 'payment.captured', 'payment.parse_failed', 'payment.matched', 'payment.reversed', 'payment.orphaned', 'submission.created', 'submission.resolved', 'lock.acquired', 'lock.consumed', 'lock.released', 'device.provisioned', 'device.revoked', 'account.degraded', 'account.recovered', 'balance.drift');--> statement-breakpoint
CREATE TYPE "public"."capture_source" AS ENUM('notification', 'sms', 'manual_entry', 'statement', 'generic_webhook', 'bridge');--> statement-breakpoint
CREATE TYPE "public"."delivery_status" AS ENUM('pending', 'delivering', 'delivered', 'failed');--> statement-breakpoint
CREATE TYPE "public"."device_status" AS ENUM('active', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."idempotency_status" AS ENUM('in_progress', 'completed');--> statement-breakpoint
CREATE TYPE "public"."ingest_adapter" AS ENUM('android_notification', 'android_sms', 'messages_bridge', 'manual_entry', 'statement_import', 'generic_webhook');--> statement-breakpoint
CREATE TYPE "public"."intent_status" AS ENUM('open', 'matched', 'partial', 'over', 'expired', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."key_environment" AS ENUM('live', 'test');--> statement-breakpoint
CREATE TYPE "public"."lock_status" AS ENUM('active', 'consumed', 'released', 'expired');--> statement-breakpoint
CREATE TYPE "public"."match_confidence" AS ENUM('exact', 'fuzzy', 'sender', 'lock', 'manual');--> statement-breakpoint
CREATE TYPE "public"."matched_by" AS ENUM('automatic', 'submission', 'admin');--> statement-breakpoint
CREATE TYPE "public"."notifier_event_kind" AS ENUM('heartbeat', 'capture', 'error', 'permission_lost', 'service_restarted', 'boot', 'parse_hint', 'bridge_session_lost', 'parse_failure', 'balance_drift', 'capture_silence', 'heartbeat_gap');--> statement-breakpoint
CREATE TYPE "public"."parse_status" AS ENUM('ok', 'partial', 'failed');--> statement-breakpoint
CREATE TYPE "public"."payment_record_status" AS ENUM('unmatched', 'matched', 'orphaned', 'refunded');--> statement-breakpoint
CREATE TYPE "public"."provider" AS ENUM('bkash', 'nagad');--> statement-breakpoint
CREATE TYPE "public"."provider_preference" AS ENUM('bkash', 'nagad', 'any');--> statement-breakpoint
CREATE TYPE "public"."ref_status" AS ENUM('open', 'consumed', 'expired');--> statement-breakpoint
CREATE TYPE "public"."submission_resolution" AS ENUM('exact', 'sender_mismatch', 'underpaid', 'overpaid', 'not_found_recent', 'not_found_stale', 'already_used', 'wrong_type', 'expired_intent');--> statement-breakpoint
CREATE TYPE "public"."submission_status" AS ENUM('pending', 'approved', 'rejected', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."transaction_type" AS ENUM('send_money', 'cash_in', 'other');--> statement-breakpoint
CREATE TYPE "public"."webhook_event_type" AS ENUM('payment.succeeded', 'payment.partial', 'payment.overpaid', 'payment.expired', 'payment.cancelled', 'payment.reversed', 'account.degraded', 'account.recovered');--> statement-breakpoint
CREATE TABLE "devices" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"receiving_account_id" uuid NOT NULL,
	"name" text NOT NULL,
	"platform" text DEFAULT 'android' NOT NULL,
	"token_prefix" text NOT NULL,
	"token_hash" text NOT NULL,
	"status" "device_status" DEFAULT 'active' NOT NULL,
	"app_version" text,
	"last_heartbeat_at" timestamp with time zone,
	"last_capture_at" timestamp with time zone,
	"last_seen_ip" text,
	"battery" integer,
	"charging" boolean,
	"network" text,
	"queue_depth" integer,
	"permissions" jsonb,
	"pending_commands" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "notifier_events" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"receiving_account_id" uuid,
	"device_id" uuid,
	"kind" "notifier_event_kind" NOT NULL,
	"severity" "alert_severity" DEFAULT 'low' NOT NULL,
	"detail" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"acknowledged_at" timestamp with time zone,
	"acknowledged_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "receiving_accounts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"provider" "provider" NOT NULL,
	"msisdn" text NOT NULL,
	"label" text NOT NULL,
	"status" "account_status" DEFAULT 'active' NOT NULL,
	"daily_limit_cents" integer DEFAULT 25000000 NOT NULL,
	"monthly_limit_cents" integer DEFAULT 300000000 NOT NULL,
	"last_heartbeat_at" timestamp with time zone,
	"last_capture_at" timestamp with time zone,
	"last_known_balance_cents" integer,
	"balance_checked_at" timestamp with time zone,
	"balance_drift" boolean DEFAULT false NOT NULL,
	"balance_drift_cents" integer,
	"status_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"app_id" uuid NOT NULL,
	"name" text NOT NULL,
	"environment" "key_environment" DEFAULT 'live' NOT NULL,
	"prefix" text NOT NULL,
	"last_four" text NOT NULL,
	"key_hash" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "apps" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"status" "app_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"app_id" uuid NOT NULL,
	"key" text NOT NULL,
	"endpoint" text NOT NULL,
	"request_hash" text NOT NULL,
	"status" "idempotency_status" DEFAULT 'in_progress' NOT NULL,
	"response_status" integer,
	"response_body" jsonb,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"endpoint_id" uuid NOT NULL,
	"app_id" uuid NOT NULL,
	"event_id" text NOT NULL,
	"event_type" "webhook_event_type" NOT NULL,
	"payload" jsonb NOT NULL,
	"status" "delivery_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"last_attempt_at" timestamp with time zone,
	"last_status_code" integer,
	"last_error" text,
	"delivered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_endpoints" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"app_id" uuid NOT NULL,
	"url" text NOT NULL,
	"description" text,
	"secret" text NOT NULL,
	"enabled_events" "webhook_event_type"[] NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_audit" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"action" "audit_action" NOT NULL,
	"actor_id" uuid,
	"actor_type" text DEFAULT 'system' NOT NULL,
	"app_id" uuid,
	"intent_id" uuid,
	"incoming_payment_id" uuid,
	"request_id" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "amount_locks" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"receiving_account_id" uuid NOT NULL,
	"amount_cents" integer NOT NULL,
	"intent_id" uuid NOT NULL,
	"status" "lock_status" DEFAULT 'active' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"released_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "incoming_payments" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"receiving_account_id" uuid NOT NULL,
	"device_id" uuid,
	"provider" "provider" NOT NULL,
	"trx_id" text,
	"sender_msisdn" text,
	"amount_cents" integer,
	"balance_after_cents" integer,
	"reference_raw" text,
	"reference_normalized" text,
	"transaction_type" "transaction_type",
	"occurred_at" timestamp with time zone,
	"captured_at" timestamp with time zone,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"raw_message" text NOT NULL,
	"package_name" text,
	"local_id" text,
	"source" "capture_source" NOT NULL,
	"adapter" "ingest_adapter" NOT NULL,
	"parse_status" "parse_status" DEFAULT 'ok' NOT NULL,
	"parse_error" text,
	"status" "payment_record_status" DEFAULT 'unmatched' NOT NULL,
	"match_attempts" integer DEFAULT 0 NOT NULL,
	"last_match_attempt_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_payments" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"intent_id" uuid NOT NULL,
	"incoming_payment_id" uuid NOT NULL,
	"applied_cents" integer NOT NULL,
	"applied_at" timestamp with time zone DEFAULT now() NOT NULL,
	"applied_by" uuid,
	"match_confidence" "match_confidence" NOT NULL,
	"matched_by" "matched_by" NOT NULL,
	"match_score" integer,
	"reversed_at" timestamp with time zone,
	"reversed_by" uuid,
	"reversal_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_intents" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"app_id" uuid NOT NULL,
	"receiving_account_id" uuid NOT NULL,
	"amount_cents" integer NOT NULL,
	"received_amount_cents" integer DEFAULT 0 NOT NULL,
	"client_reference" text NOT NULL,
	"payer_msisdn" text,
	"provider_preference" "provider_preference" DEFAULT 'any' NOT NULL,
	"status" "intent_status" DEFAULT 'open' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ttl_seconds" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"pay_clicked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"matched_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"expired_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_refs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"code" varchar(8) NOT NULL,
	"intent_id" uuid NOT NULL,
	"status" "ref_status" DEFAULT 'open' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"cooldown_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_submissions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"intent_id" uuid NOT NULL,
	"app_id" uuid NOT NULL,
	"trx_id" text NOT NULL,
	"sender_msisdn" text,
	"claimed_amount_cents" integer,
	"status" "submission_status" DEFAULT 'pending' NOT NULL,
	"resolution" "submission_resolution",
	"incoming_payment_id" uuid,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"note" text,
	"ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_receiving_account_id_receiving_accounts_id_fk" FOREIGN KEY ("receiving_account_id") REFERENCES "public"."receiving_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifier_events" ADD CONSTRAINT "notifier_events_receiving_account_id_receiving_accounts_id_fk" FOREIGN KEY ("receiving_account_id") REFERENCES "public"."receiving_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifier_events" ADD CONSTRAINT "notifier_events_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_endpoint_id_webhook_endpoints_id_fk" FOREIGN KEY ("endpoint_id") REFERENCES "public"."webhook_endpoints"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_endpoints" ADD CONSTRAINT "webhook_endpoints_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_audit" ADD CONSTRAINT "payment_audit_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_audit" ADD CONSTRAINT "payment_audit_intent_id_payment_intents_id_fk" FOREIGN KEY ("intent_id") REFERENCES "public"."payment_intents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_audit" ADD CONSTRAINT "payment_audit_incoming_payment_id_incoming_payments_id_fk" FOREIGN KEY ("incoming_payment_id") REFERENCES "public"."incoming_payments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "amount_locks" ADD CONSTRAINT "amount_locks_receiving_account_id_receiving_accounts_id_fk" FOREIGN KEY ("receiving_account_id") REFERENCES "public"."receiving_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "amount_locks" ADD CONSTRAINT "amount_locks_intent_id_payment_intents_id_fk" FOREIGN KEY ("intent_id") REFERENCES "public"."payment_intents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incoming_payments" ADD CONSTRAINT "incoming_payments_receiving_account_id_receiving_accounts_id_fk" FOREIGN KEY ("receiving_account_id") REFERENCES "public"."receiving_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incoming_payments" ADD CONSTRAINT "incoming_payments_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_payments" ADD CONSTRAINT "order_payments_intent_id_payment_intents_id_fk" FOREIGN KEY ("intent_id") REFERENCES "public"."payment_intents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_payments" ADD CONSTRAINT "order_payments_incoming_payment_id_incoming_payments_id_fk" FOREIGN KEY ("incoming_payment_id") REFERENCES "public"."incoming_payments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_intents" ADD CONSTRAINT "payment_intents_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_intents" ADD CONSTRAINT "payment_intents_receiving_account_id_receiving_accounts_id_fk" FOREIGN KEY ("receiving_account_id") REFERENCES "public"."receiving_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_refs" ADD CONSTRAINT "payment_refs_intent_id_payment_intents_id_fk" FOREIGN KEY ("intent_id") REFERENCES "public"."payment_intents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_submissions" ADD CONSTRAINT "payment_submissions_intent_id_payment_intents_id_fk" FOREIGN KEY ("intent_id") REFERENCES "public"."payment_intents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_submissions" ADD CONSTRAINT "payment_submissions_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_submissions" ADD CONSTRAINT "payment_submissions_incoming_payment_id_incoming_payments_id_fk" FOREIGN KEY ("incoming_payment_id") REFERENCES "public"."incoming_payments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ux_devices_token_prefix" ON "devices" USING btree ("token_prefix");--> statement-breakpoint
CREATE INDEX "ix_devices_account" ON "devices" USING btree ("receiving_account_id","status");--> statement-breakpoint
CREATE INDEX "ix_notifier_events_recent" ON "notifier_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "ix_notifier_events_kind" ON "notifier_events" USING btree ("kind","created_at");--> statement-breakpoint
CREATE INDEX "ix_notifier_events_account" ON "notifier_events" USING btree ("receiving_account_id","created_at");--> statement-breakpoint
CREATE INDEX "ix_notifier_events_open" ON "notifier_events" USING btree ("acknowledged_at","severity");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_receiving_accounts_msisdn" ON "receiving_accounts" USING btree ("msisdn");--> statement-breakpoint
CREATE INDEX "ix_receiving_accounts_status" ON "receiving_accounts" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_api_keys_prefix" ON "api_keys" USING btree ("prefix");--> statement-breakpoint
CREATE INDEX "ix_api_keys_app" ON "api_keys" USING btree ("app_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_apps_slug" ON "apps" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_idempotency_app_key" ON "idempotency_keys" USING btree ("app_id","key");--> statement-breakpoint
CREATE INDEX "ix_idempotency_expiry" ON "idempotency_keys" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_webhook_deliveries_endpoint_event" ON "webhook_deliveries" USING btree ("endpoint_id","event_id");--> statement-breakpoint
CREATE INDEX "ix_webhook_deliveries_due" ON "webhook_deliveries" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "ix_webhook_deliveries_app" ON "webhook_deliveries" USING btree ("app_id","created_at");--> statement-breakpoint
CREATE INDEX "ix_webhook_endpoints_app" ON "webhook_endpoints" USING btree ("app_id","status");--> statement-breakpoint
CREATE INDEX "ix_audit_intent" ON "payment_audit" USING btree ("intent_id","created_at");--> statement-breakpoint
CREATE INDEX "ix_audit_payment" ON "payment_audit" USING btree ("incoming_payment_id","created_at");--> statement-breakpoint
CREATE INDEX "ix_audit_recent" ON "payment_audit" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "ix_audit_action" ON "payment_audit" USING btree ("action","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_amount_locks_active" ON "amount_locks" USING btree ("receiving_account_id","amount_cents") WHERE status = 'active';--> statement-breakpoint
CREATE INDEX "ix_amount_locks_intent" ON "amount_locks" USING btree ("intent_id");--> statement-breakpoint
CREATE INDEX "ix_amount_locks_sweep" ON "amount_locks" USING btree ("status","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_incoming_payments_trx" ON "incoming_payments" USING btree ("trx_id");--> statement-breakpoint
CREATE INDEX "ix_incoming_payments_feed" ON "incoming_payments" USING btree ("received_at");--> statement-breakpoint
CREATE INDEX "ix_incoming_payments_status" ON "incoming_payments" USING btree ("status","received_at");--> statement-breakpoint
CREATE INDEX "ix_incoming_payments_candidates" ON "incoming_payments" USING btree ("receiving_account_id","amount_cents","status");--> statement-breakpoint
CREATE INDEX "ix_incoming_payments_reference" ON "incoming_payments" USING btree ("reference_normalized");--> statement-breakpoint
CREATE INDEX "ix_incoming_payments_parse_failures" ON "incoming_payments" USING btree ("parse_status","received_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_order_payments_incoming" ON "order_payments" USING btree ("incoming_payment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_order_payments_pair" ON "order_payments" USING btree ("intent_id","incoming_payment_id");--> statement-breakpoint
CREATE INDEX "ix_order_payments_intent" ON "order_payments" USING btree ("intent_id");--> statement-breakpoint
CREATE INDEX "ix_intents_app_reference" ON "payment_intents" USING btree ("app_id","client_reference");--> statement-breakpoint
CREATE INDEX "ix_intents_open_expiry" ON "payment_intents" USING btree ("status","expires_at");--> statement-breakpoint
CREATE INDEX "ix_intents_candidates" ON "payment_intents" USING btree ("receiving_account_id","amount_cents","status");--> statement-breakpoint
CREATE INDEX "ix_intents_recent" ON "payment_intents" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_payment_refs_code_open" ON "payment_refs" USING btree ("code") WHERE status = 'open';--> statement-breakpoint
CREATE INDEX "ix_payment_refs_code" ON "payment_refs" USING btree ("code","status");--> statement-breakpoint
CREATE INDEX "ix_payment_refs_intent" ON "payment_refs" USING btree ("intent_id");--> statement-breakpoint
CREATE INDEX "ix_payment_refs_cooldown" ON "payment_refs" USING btree ("cooldown_until");--> statement-breakpoint
CREATE INDEX "ix_submissions_intent_recent" ON "payment_submissions" USING btree ("intent_id","created_at");--> statement-breakpoint
CREATE INDEX "ix_submissions_trx" ON "payment_submissions" USING btree ("trx_id");--> statement-breakpoint
CREATE INDEX "ix_submissions_app_recent" ON "payment_submissions" USING btree ("app_id","created_at");