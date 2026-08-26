import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const backup = readFileSync(".github/workflows/database-backup.yml", "utf8");
const restore = readFileSync(".github/workflows/database-restore-verification.yml", "utf8");

assert.match(backup, /postgresql-client-17/, "backup workflow must install a PostgreSQL 17 client");
assert.match(backup, /\/usr\/lib\/postgresql\/17\/bin\/pg_dump/, "backup workflow must explicitly use pg_dump 17");
assert.match(restore, /image: postgres:17/, "restore verification must use PostgreSQL 17");
assert.match(restore, /postgresql-client-17/, "restore verification must install a PostgreSQL 17 client");
assert.match(restore, /\/usr\/lib\/postgresql\/17\/bin\/psql/, "restore verification must explicitly use psql 17");

console.log("backup workflow PostgreSQL-version checks passed");
