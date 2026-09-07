DROP INDEX "ux_receiving_accounts_msisdn";--> statement-breakpoint
CREATE UNIQUE INDEX "ux_receiving_accounts_msisdn_provider" ON "receiving_accounts" USING btree ("msisdn","provider");