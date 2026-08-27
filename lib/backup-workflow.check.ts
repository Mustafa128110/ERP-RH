import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const backup = readFileSync(".github/workflows/database-backup.yml", "utf8");
const restore = readFileSync(".github/workflows/database-restore-verification.yml", "utf8");

assert.match(backup, /docker run --rm postgres:17 pg_dump --version/, "backup workflow must verify PostgreSQL 17 pg_dump");
assert.match(backup, /docker run --rm --env DATABASE_URL_DIRECT --volume/, "backup workflow must use PostgreSQL 17 pg_dump in a container");
assert.match(restore, /image: postgres:17/, "restore verification must use PostgreSQL 17");
assert.match(restore, /docker run --rm postgres:17 psql --version/, "restore verification must verify PostgreSQL 17 psql");
assert.match(restore, /docker run --rm --network host --volume/, "restore verification must use PostgreSQL 17 psql in a container");

console.log("backup workflow PostgreSQL-version checks passed");
