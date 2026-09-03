ALTER TYPE "public"."audit_action" ADD VALUE 'apikey.created';--> statement-breakpoint
ALTER TYPE "public"."audit_action" ADD VALUE 'apikey.revoked';--> statement-breakpoint
ALTER TYPE "public"."audit_action" ADD VALUE 'endpoint.created';--> statement-breakpoint
ALTER TYPE "public"."audit_action" ADD VALUE 'webhook.replayed';--> statement-breakpoint
ALTER TYPE "public"."audit_action" ADD VALUE 'statement.imported';