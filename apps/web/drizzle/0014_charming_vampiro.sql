CREATE TABLE "instance_setup" (
	"id" boolean PRIMARY KEY DEFAULT true NOT NULL,
	"completed_at" timestamp with time zone,
	"completed_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
