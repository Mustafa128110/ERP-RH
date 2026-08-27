import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const drizzleDirectory = path.join(root, "drizzle");
const supabaseDirectory = path.join(root, "supabase", "migrations");

function drizzleNumber(fileName: string): string | null {
  return /^(\d{4})_.+\.sql$/.exec(fileName)?.[1] ?? null;
}

function supabaseNumber(fileName: string): string | null {
  const timestamp = /^(\d{14})_.+\.sql$/.exec(fileName)?.[1];
  return timestamp ? timestamp.slice(-4) : null;
}

function normalizeSql(sql: string) {
  return sql.replace(/\r\n/g, "\n").trim();
}

async function main() {
  const [drizzleFiles, supabaseFiles, journalText] = await Promise.all([
    readdir(drizzleDirectory),
    readdir(supabaseDirectory),
    readFile(path.join(drizzleDirectory, "meta", "_journal.json"), "utf8"),
  ]);

  const drizzleByNumber = new Map(
    drizzleFiles
      .map((fileName) => [drizzleNumber(fileName), fileName] as const)
      .filter((entry): entry is [string, string] => entry[0] !== null),
  );
  const supabaseByNumber = new Map(
    supabaseFiles
      .map((fileName) => [supabaseNumber(fileName), fileName] as const)
      .filter((entry): entry is [string, string] => entry[0] !== null),
  );

  assert.deepEqual(
    [...supabaseByNumber.keys()].sort(),
    [...drizzleByNumber.keys()].sort(),
    "Supabase and Drizzle migration numbers must match exactly",
  );

  const journal = JSON.parse(journalText) as { entries?: { tag?: string }[] };
  const journalTags = (journal.entries ?? []).map((entry) => entry.tag).filter((tag): tag is string => Boolean(tag)).sort();
  const migrationTags = [...drizzleByNumber.values()].map((fileName) => fileName.replace(/\.sql$/, "")).sort();
  assert.deepEqual(
    journalTags,
    migrationTags,
    "Every Drizzle SQL migration must be registered in drizzle/meta/_journal.json; unjournaled files are silently skipped by drizzle-kit migrate",
  );

  await Promise.all(
    [...drizzleByNumber].map(async ([number, drizzleFile]) => {
      const supabaseFile = supabaseByNumber.get(number);
      assert.ok(supabaseFile, `missing Supabase mirror for Drizzle migration ${drizzleFile}`);
      const [drizzleSql, supabaseSql] = await Promise.all([
        readFile(path.join(drizzleDirectory, drizzleFile), "utf8"),
        readFile(path.join(supabaseDirectory, supabaseFile), "utf8"),
      ]);
      assert.equal(normalizeSql(supabaseSql), normalizeSql(drizzleSql), `migration ${number} SQL differs`);
    }),
  );

  console.log(`Supabase migration parity checks passed (${drizzleByNumber.size} migration(s))`);
}

void main();
