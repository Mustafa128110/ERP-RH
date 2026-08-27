-- This application never reads or writes ERP tables through Supabase
-- PostgREST. The browser uses the anon key for Auth only; every data operation
-- reaches the database through an authenticated Server Action and the direct
-- server-only connection. Leaving Supabase's default anon/authenticated grants
-- in place while RLS is disabled bypasses that entire permission boundary.
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM anon, authenticated;--> statement-breakpoint
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;--> statement-breakpoint
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon, authenticated;--> statement-breakpoint
REVOKE ALL PRIVILEGES ON SCHEMA public FROM anon, authenticated;--> statement-breakpoint

-- Keep later migrations closed by default. These defaults apply to objects
-- created by the migration owner; a deliberate future browser-facing API must
-- opt in with a narrowly scoped grant and RLS policy in the same migration.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL PRIVILEGES ON TABLES FROM anon, authenticated;--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL PRIVILEGES ON SEQUENCES FROM anon, authenticated;--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;
