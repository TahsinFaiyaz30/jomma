CREATE TYPE "public"."business_status" AS ENUM('pending', 'active', 'rejected', 'suspended');--> statement-breakpoint
CREATE TYPE "public"."membership_role" AS ENUM('owner', 'admin', 'viewer');--> statement-breakpoint
CREATE TABLE "businesses" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"status" "business_status" DEFAULT 'pending' NOT NULL,
	"status_reason" text,
	"contact_email" text,
	"contact_phone" text,
	"description" text,
	"reviewed_at" timestamp with time zone,
	"reviewed_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invitations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"business_id" uuid NOT NULL,
	"email" text NOT NULL,
	"role" "membership_role" DEFAULT 'admin' NOT NULL,
	"token_hash" text NOT NULL,
	"invited_by" text,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" text NOT NULL,
	"business_id" uuid NOT NULL,
	"role" "membership_role" DEFAULT 'admin' NOT NULL,
	"invited_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user" ALTER COLUMN "role" SET DEFAULT 'member';--> statement-breakpoint

-- Added nullable, backfilled, then constrained. Generated as a plain NOT NULL
-- ADD COLUMN, which is correct for an empty database and fails immediately on
-- any instance that has ever taken a payment -- which is every instance this
-- migration actually has to survive.
ALTER TABLE "receiving_accounts" ADD COLUMN "business_id" uuid;--> statement-breakpoint
ALTER TABLE "apps" ADD COLUMN "business_id" uuid;--> statement-breakpoint


ALTER TABLE "invitations" ADD CONSTRAINT "invitations_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ux_businesses_slug" ON "businesses" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "ix_businesses_status" ON "businesses" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_invitations_token" ON "invitations" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_invitations_business_email" ON "invitations" USING btree ("business_id","email");--> statement-breakpoint
CREATE INDEX "ix_invitations_business" ON "invitations" USING btree ("business_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_memberships_user_business" ON "memberships" USING btree ("user_id","business_id");--> statement-breakpoint
CREATE INDEX "ix_memberships_user" ON "memberships" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "ix_memberships_business" ON "memberships" USING btree ("business_id","role");--> statement-breakpoint
ALTER TABLE "receiving_accounts" ADD CONSTRAINT "receiving_accounts_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "apps" ADD CONSTRAINT "apps_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_receiving_accounts_business" ON "receiving_accounts" USING btree ("business_id","status");--> statement-breakpoint
CREATE INDEX "ix_apps_business" ON "apps" USING btree ("business_id","status");--> statement-breakpoint
-- An existing deployment is a single business that predates the concept of
-- one, so give it the concept and put everything it owns inside.
--
-- Guarded on there being anything to adopt: on a fresh database this is a no-op
-- and the seed creates the business properly, with a real name. Creating an
-- orphan "Default" on every new install would leave a row nobody asked for and
-- a slug taken.
DO $$
DECLARE
  default_business_id uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM apps)
     OR EXISTS (SELECT 1 FROM receiving_accounts)
     OR EXISTS (SELECT 1 FROM "user")
  THEN
    -- Active, not pending. This instance was already taking money before the
    -- approval gate existed; introducing one must not retroactively switch it
    -- off.
    INSERT INTO businesses (name, slug, status)
    VALUES ('Default', 'default', 'active')
    RETURNING id INTO default_business_id;

    UPDATE apps SET business_id = default_business_id WHERE business_id IS NULL;
    UPDATE receiving_accounts SET business_id = default_business_id WHERE business_id IS NULL;

    -- Everyone who could sign in before can still see everything they could
    -- see before, which for a single-tenant instance means owning it.
    INSERT INTO memberships (user_id, business_id, role)
    SELECT id, default_business_id, 'owner' FROM "user"
    ON CONFLICT (user_id, business_id) DO NOTHING;

    -- These people were operating the instance, which is now a distinct grant
    -- from operating a business. Without this the migration would silently
    -- demote every existing admin to a plain member and leave nobody able to
    -- approve anything.
    UPDATE "user" SET role = 'platform_admin' WHERE role = 'admin';
  END IF;
END $$;--> statement-breakpoint

ALTER TABLE "receiving_accounts" ALTER COLUMN "business_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "apps" ALTER COLUMN "business_id" SET NOT NULL;