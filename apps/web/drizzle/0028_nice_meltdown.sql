CREATE TYPE "public"."payer_msisdn_source" AS ENUM('store', 'buyer');--> statement-breakpoint
ALTER TABLE "payment_intents" ADD COLUMN "payer_msisdn_source" "payer_msisdn_source";--> statement-breakpoint
--
-- Existing numbers are treated as suggestions, not as answers.
--
-- Before this column the two were indistinguishable, so there is nothing to
-- read to tell them apart. 'store' is the conservative reading: it costs a live
-- buyer one extra tap to confirm a number that was already right, where the
-- other way round would carry the very bug this column exists to fix — a
-- store's guess taken as settled fact, silently costing the matching signal.
--
-- In practice this touches almost nothing. Intents expire in minutes, so a row
-- old enough to predate this migration is old enough to be closed.
--
UPDATE "payment_intents" SET "payer_msisdn_source" = 'store' WHERE "payer_msisdn" IS NOT NULL;
