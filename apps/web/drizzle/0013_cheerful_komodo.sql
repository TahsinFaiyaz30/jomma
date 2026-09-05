ALTER TYPE "public"."audit_action" ADD VALUE 'account.created' BEFORE 'account.degraded';--> statement-breakpoint
ALTER TYPE "public"."audit_action" ADD VALUE 'app.created' BEFORE 'app.updated';