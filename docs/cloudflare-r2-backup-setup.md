# Cloudflare R2 automated backup setup

The GitHub workflow in `.github/workflows/database-backup.yml` runs at 3:00 PM and 8:30 PM Pakistan time every day. It keeps one encrypted object only: `erp-backups/latest.zip`.

Create a dedicated R2 bucket and API token limited to that bucket with Object Read and Write permission. Keep bucket versioning disabled: versioning would retain overwritten archives and violate the one-archive retention rule.

Add these repository Action secrets:

- `DATABASE_URL_DIRECT` — Supabase direct PostgreSQL connection string.
- `R2_ENDPOINT` — `https://<account-id>.r2.cloudflarestorage.com`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_BUCKET`
- `BACKUP_ARCHIVE_PASSWORD` — a long unique password, stored only as a GitHub secret and password manager entry.

The encrypted ZIP contains `roles.sql`, `schema.sql`, `data.sql`, and `manifest.json`. `roles.sql` is the ERP application role/permission data. Hosted Supabase does not permit application credentials to export PostgreSQL server-global roles; those are platform-managed and are not needed to restore this application.

The workflow uploads a staging object, verifies it, replaces `latest.zip`, verifies that object, and only then clears staging/old objects. A failed run therefore leaves the previous valid archive in place.

There is intentionally no scheduled restore test. A production restore must never be automated. An administrator can request a restore verification later, at which point it must restore only into a disposable database and report the result.
