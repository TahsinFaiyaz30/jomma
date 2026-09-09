ALTER TYPE "public"."notifier_event_kind" ADD VALUE 'jobs_silent';--> statement-breakpoint
ALTER TYPE "public"."notifier_event_kind" ADD VALUE 'webhook_backlog';--> statement-breakpoint
CREATE TABLE "job_runs" (
	"group" text PRIMARY KEY NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone NOT NULL,
	"duration_ms" integer NOT NULL,
	"last_result" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
