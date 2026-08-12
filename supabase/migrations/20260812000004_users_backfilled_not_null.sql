-- 0002 added supabase_auth_id/email as nullable (hand-edited from drizzle-kit's
-- generated NOT NULL, since the one existing users row had no auth link yet)
-- so the migration wouldn't fail. That row is now backfilled — restore the
-- NOT NULL the schema always declared. drizzle-kit generate reports "no
-- changes" here because its snapshot already recorded NOT NULL from the
-- original 0002 generation, even though the hand-edited SQL that actually ran
-- left the live column nullable — this migration reconciles that drift.
ALTER TABLE "users" ALTER COLUMN "supabase_auth_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "email" SET NOT NULL;
