CREATE TABLE command_receipts (
  id uuid PRIMARY KEY,
  -- Preserve ownership after an account is deleted, without blocking deletion.
  user_id uuid NOT NULL,
  action text NOT NULL,
  payload_hash text NOT NULL,
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
REVOKE ALL ON command_receipts FROM anon, authenticated;
--> statement-breakpoint
ALTER TABLE command_receipts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE INDEX command_receipts_user_created ON command_receipts(user_id, created_at);
