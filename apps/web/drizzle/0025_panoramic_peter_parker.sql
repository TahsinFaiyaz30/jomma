-- One receiving account per provider, per business.
--
-- A shop has a bKash number and a Nagad number, not two bKash numbers. It is
-- also the only rule the phone can actually enforce: a notification names its
-- provider and nothing else, so two bKash accounts on one handset cannot be
-- told apart from a notification however much anyone wants them to be.
--
-- ## Why this does more than create an index
--
-- A deployment can already be in breach — the development seed created exactly
-- this shape, two bKash accounts under one business, to demonstrate failover.
-- A bare CREATE UNIQUE INDEX against that data fails, and a migration that
-- fails is a deploy that stops halfway with the service down.
--
-- So the duplicates are stood down first rather than the migration refusing to
-- run. Nothing is deleted: the losing rows keep every payment, every intent and
-- every device that references them, and go to `disabled`, which is a state the
-- product already understands and the dashboard already shows. Re-enabling one
-- is a decision for whoever owns the business, and they can make it after
-- disabling the other.
--
-- The survivor is the one that has most recently been heard from, falling back
-- to the oldest. That is the account with a phone actually watching it, which
-- is the one a merchant would pick if asked.

DO $$
DECLARE
  stood_down integer;
BEGIN
  WITH ranked AS (
    SELECT id,
           row_number() OVER (
             PARTITION BY business_id, provider
             ORDER BY last_heartbeat_at DESC NULLS LAST, created_at ASC
           ) AS rank
      FROM receiving_accounts
     WHERE status IN ('active', 'degraded')
  )
  UPDATE receiving_accounts AS ra
     SET status = 'disabled'
    FROM ranked
   WHERE ranked.id = ra.id
     AND ranked.rank > 1;

  GET DIAGNOSTICS stood_down = ROW_COUNT;

  IF stood_down > 0 THEN
    RAISE NOTICE
      'Disabled % duplicate receiving account(s): a business may now hold only one account per provider. Nothing was deleted; re-enable from the dashboard after removing the other.',
      stood_down;
  END IF;
END $$;--> statement-breakpoint

CREATE UNIQUE INDEX "ux_receiving_accounts_business_provider"
    ON "receiving_accounts" USING btree ("business_id","provider")
 WHERE status in ('active', 'degraded');
