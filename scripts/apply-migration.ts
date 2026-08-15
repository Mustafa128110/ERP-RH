import { readFileSync } from "node:fs";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

// Applies a single drizzle migration file to the live database. drizzle-kit
// migrate can't be used here: this DB was migrated out-of-band (marked applied),
// so a full replay would fail on already-existing objects. The file to apply is
// passed as argv[2]. Statements are split on the drizzle `--> statement-breakpoint`
// marker and run in one transaction — all-or-nothing, same as a real migrate.

const file = process.argv[2];
if (!file) {
  console.error("Usage: npx tsx --env-file=.env scripts/apply-migration.ts <drizzle-file>");
  process.exit(1);
}

const statements = readFileSync(file, "utf8")
  .split("--> statement-breakpoint")
  .map((s) => s.trim())
  .filter(Boolean);

if (statements.length === 0) {
  console.error("no statements found");
  process.exit(1);
}

async function main() {
  await db.transaction(async (tx) => {
    for (const statement of statements) {
      await tx.execute(sql.raw(statement));
    }
  });
  console.log(`applied ${statements.length} statement(s) from ${file}`);
  await db.$client.end();
}

main().catch((e) => {
  console.error("ERR", e);
  process.exit(1);
});
