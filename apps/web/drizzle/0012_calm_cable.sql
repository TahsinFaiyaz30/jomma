DROP INDEX "ux_payment_refs_code_open";--> statement-breakpoint
DROP INDEX "ix_payment_refs_code";--> statement-breakpoint
DROP INDEX "ix_payment_refs_cooldown";--> statement-breakpoint
CREATE UNIQUE INDEX "ux_payment_refs_code" ON "payment_refs" USING btree ("code");--> statement-breakpoint
ALTER TABLE "payment_refs" DROP COLUMN "cooldown_until";