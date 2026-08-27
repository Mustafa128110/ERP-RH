-- Supabase roles can inherit privileges granted to PostgreSQL's universal
-- PUBLIC pseudo-role. Revoking only from anon/authenticated therefore does not
-- close the API when an earlier migration granted access to PUBLIC.
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM PUBLIC;--> statement-breakpoint
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC;--> statement-breakpoint
REVOKE ALL PRIVILEGES ON SCHEMA public FROM PUBLIC;--> statement-breakpoint

ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL PRIVILEGES ON TABLES FROM PUBLIC;--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL PRIVILEGES ON SEQUENCES FROM PUBLIC;
