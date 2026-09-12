# Cloudflare R2 automated backup setup

The GitHub workflow in `.github/workflows/database-backup.yml` runs at 3:00 PM and 8:30 PM Pakistan time every day. It keeps `erp-backups/latest.zip` plus encrypted recovery history under `erp-backups/history/`.

Create a dedicated R2 bucket and API token limited to that bucket with Object Read and Write permission. The workflow manages archive retention directly; bucket versioning is not required. It keeps every run for 14 days, weekly copies for eight weeks, monthly copies for 93 days, and at least the newest 14 archives. It only prunes recognized history archive names. Unknown objects are left alone.

Add these repository Action secrets:

- `DATABASE_URL_DIRECT` — Supabase direct PostgreSQL connection string.
- `R2_ENDPOINT` — `https://<account-id>.r2.cloudflarestorage.com`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_BUCKET`
- `BACKUP_ARCHIVE_PASSWORD` — a long unique password, stored only as a GitHub secret and password manager entry.

The AES-256 encrypted ZIP contains one consistent `snapshot.dump`, extracted `roles.sql`, `schema.sql`, `data.sql`, and a SHA-256 `manifest.json`. `roles.sql` contains ERP application role/permission data. PostgreSQL server-global roles and hosted Supabase services must be provisioned by the restore target.

The workflow uploads a staging object, downloads and verifies its checksum and encryption, copies it into retained history, replaces `latest.zip`, verifies its metadata, and only then clears that staging object and expired history. A failed upload leaves the previous valid archive in place.

After each successful backup, `database-restore-verification.yml` verifies all archive members and restores the ERP public schema, Supabase auth data, and migration history into a disposable PostgreSQL 17 service. It never restores into production. Hosted realtime, storage and vault services require Supabase provisioning separately.

For an exact source-to-restore comparison, `scripts/create-verified-backup.mjs` exports a shared PostgreSQL snapshot and fingerprints every public table. `scripts/verify-backup-restore.mjs` restores that archive into a new loopback-only database and compares every table, row count and constraint. Outputs are stored in ignored `db-export/` directories. Archive passwords and cloud credentials remain in environment variables.
