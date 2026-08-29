import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { cached, invalidate, invalidateAll } from "./cache";
import { READ_DEPENDS_ON, READ_DOCUMENT_TYPES, READ_DOMAIN, type ReadDomain } from "./cache-keys";

// Four checks, no database needed:
//
//   1. the cache primitive behaves (dedupes, expires, evicts on failure)
//   2. every action that writes a table behind a cached lookup invalidates it
//   3. every action that writes a table behind a cached *page read* invalidates
//      every read domain that selects it
//   4. the two maps those rules read from still describe the schema
//
// The middle two are the ones that matter. A broken invalidate() call is a type
// error; a *missing* one is silent, and shows up as a brand you just created
// not appearing in a dropdown for five minutes. This asserts coverage so that
// failure mode can't be introduced quietly.
//
// Rule 3 exists because invalidateLookups() used to drop the whole `page_reads:`
// prefix, so every write cleared every list on every screen — slow, but never
// wrong. Clearing only the affected domains is what makes the cache warm, and it
// trades that safety for speed: a domain missed here serves a stale list for the
// whole TTL. This rule is how the safety is bought back.
//
// The dashboard and report caches are covered by the same rule transitively:
// invalidateLookups() clears them on every call, and this check holds every
// mutating action to calling invalidateLookups, so any write that could change
// an aggregate busts its cache entry in the same commit.
//
//   npx tsx --conditions=react-server lib/cache.check.ts

async function checkPrimitive() {
  await invalidateAll();

  let calls = 0;
  const load = async () => {
    calls++;
    return "value";
  };

  assert.equal(await cached("k", 1000, load), "value");
  assert.equal(await cached("k", 1000, load), "value");
  assert.equal(calls, 1, "second read should hit the cache");

  // Concurrent misses share one in-flight load rather than stampeding.
  await invalidateAll();
  calls = 0;
  const slow = async () => {
    calls++;
    await new Promise((r) => setTimeout(r, 20));
    return "shared";
  };
  const all = await Promise.all(Array.from({ length: 12 }, () => cached("burst", 1000, slow)));
  assert.deepEqual(all, Array(12).fill("shared"));
  assert.equal(calls, 1, "twelve concurrent readers should trigger one load");

  // Expiry.
  calls = 0;
  await cached("ttl", 10, load);
  await new Promise((r) => setTimeout(r, 25));
  await cached("ttl", 10, load);
  assert.equal(calls, 2, "entry should reload after its TTL");

  // A failed load must not be cached.
  await invalidateAll();
  let attempts = 0;
  const failing = async () => {
    attempts++;
    throw new Error("boom");
  };
  await assert.rejects(() => cached("bad", 1000, failing));
  await assert.rejects(() => cached("bad", 1000, failing));
  assert.equal(attempts, 2, "a rejected load must evict itself");

  // invalidate() clears parameterised variants too.
  await invalidateAll();
  calls = 0;
  await cached("cheques", 1000, load);
  await cached("cheques:doc-1", 1000, load);
  await invalidate("cheques");
  await cached("cheques", 1000, load);
  await cached("cheques:doc-1", 1000, load);
  assert.equal(calls, 4, "invalidate should clear the key and its variants");

  // Production never falls back to a private cache when shared Redis is absent:
  // that would make writes served by another instance look stale.
  const priorNodeEnv = process.env.NODE_ENV;
  const priorUpstashUrl = process.env.UPSTASH_REDIS_REST_URL;
  const priorUpstashToken = process.env.UPSTASH_REDIS_REST_TOKEN;
  (process.env as Record<string, string | undefined>).NODE_ENV = "production";
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  try {
    await invalidateAll();
    calls = 0;
    await cached("production-without-redis", 1000, load);
    await cached("production-without-redis", 1000, load);
    assert.equal(calls, 2, "production must bypass the local cache without Redis");
  } finally {
    (process.env as Record<string, string | undefined>).NODE_ENV = priorNodeEnv;
    if (priorUpstashUrl === undefined) delete process.env.UPSTASH_REDIS_REST_URL;
    else process.env.UPSTASH_REDIS_REST_URL = priorUpstashUrl;
    if (priorUpstashToken === undefined) delete process.env.UPSTASH_REDIS_REST_TOKEN;
    else process.env.UPSTASH_REDIS_REST_TOKEN = priorUpstashToken;
  }

  await invalidateAll();
  console.log("ok  cache primitive: dedupe, expiry, failure eviction, prefix invalidation, production no-local fallback");
}

// Tables that back a cached lookup -> the CACHE key that must be invalidated.
// documents and expenses are here because linking a cheque to either is what
// makes it stop being "available".
const TABLE_TO_KEY: Record<string, string> = {
  companies: "companies",
  categories: "categories",
  brands: "brands",
  locations: "locations",
  units: "units",
  documentTypes: "documentTypes",
  expenseCategories: "expenseCategories",
  items: "items",
  itemUnitConversionRules: "items",
  contacts: "contacts",
  bankAccounts: "bankAccounts",
  cashAccounts: "cashAccounts",
  chequeRegister: "cheques",
  documents: "cheques",
  expenses: "cheques",
};

// settlement.ts is exempt from the *lookup* rule because adjustSettlementBalance
// only moves a balance column and no cached lookup selects a balance. It is not
// exempt from the read-domain rule: the accounts screen reads those balances, and
// the move is raw SQL the write regex above cannot see — which is why any file
// calling it must declare `accounts` (checkReadDomainCoverage, below).
//
// resolve-refs.ts is exempt for a different reason: it only ever runs inside
// another action's transaction, creating the item/unit/contact a line named.
// Invalidating from there would drop the cache before the transaction commits,
// so the next reader could repopulate it from data that then rolled back. Its
// callers invalidate after their commit, which is the correct place — and
// cache.check's own coverage rule is what holds them to it. A row it creates is
// new, so no cached list of existing documents can be showing it yet; the caller
// that goes on to write a document referencing it declares that document's
// domains anyway.
//
// guard.ts writes nothing; it wraps the actions that do.
const EXEMPT = new Set(["settlement.ts", "resolve-refs.ts", "guard.ts"]);

const WRITE_RE = /\.(?:insert|update|delete)\((\w+)\)/g;

function actionFiles() {
  const dir = path.join(process.cwd(), "lib/actions");
  return fs
    .readdirSync(dir)
    .filter((file) => file.endsWith(".ts") && !file.endsWith(".check.ts"))
    .map((file) => ({ file, src: fs.readFileSync(path.join(dir, file), "utf8") }));
}

function writtenTables(src: string) {
  return new Set([...src.matchAll(WRITE_RE)].map((m) => m[1]));
}

function checkInvalidationCoverage() {
  let gaps = 0;
  let checked = 0;

  for (const { file, src } of actionFiles()) {
    if (EXEMPT.has(file)) continue;

    // Only mutations count — a bare select never invalidates anything.
    const written = new Set([...writtenTables(src)].map((table) => TABLE_TO_KEY[table]).filter(Boolean));
    if (written.size === 0) continue;
    checked++;

    const declared = new Set([...src.matchAll(/CACHE\.(\w+)/g)].map((m) => m[1]));
    const missing = [...written].filter((k) => !declared.has(k));

    if (missing.length) {
      gaps++;
      console.log(`FAIL ${file}: writes tables behind ${missing.join(", ")} but never invalidates them`);
    } else {
      console.log(`ok   ${file.padEnd(22)} invalidates ${[...written].sort().join(", ")}`);
    }
  }

  assert.equal(gaps, 0, `${gaps} action file(s) write a cached table without invalidating it`);
  console.log(`\nok  invalidation coverage: ${checked} mutating action file(s), no gaps`);
}

// `documents` and `document_lines` hold every kind of document in the system, so
// a table-level dependency would have entering a payment clear the sales list.
// Every cached read that selects them filters on document_types.code, so the
// dependency these two tables carry is (table, code) -> domain, resolved below
// against the document-type literals the file actually names.
const DOCUMENT_TABLES = new Set(["documents", "documentLines"]);

// Written tables that back no cached page read, each with the reason. Anything
// written and absent from both this and READ_DEPENDS_ON fails the check — that is
// what stops a new table from quietly joining a list without an invalidation.
const NO_DOMAIN: Record<string, string> = {
  auditLogs: "the trail is queried directly, never through a cached read",
  documentTypes: "insert-only, and a brand-new type has no documents to appear beside",
  documentNumberLedger: "written beside every document, selected by no list",
  marketPurchaseRequests: "the market-purchase screen is not a cachedPageRead",
  contactOpeningBalances: "a pointer at the OPENING_BALANCE document; the ledger reads the document",
  unitConversions: "base quantities are resolved and stored on the line at write time",
  itemImages: "read per item on the detail screen, not in any list",
  taxes: "a document's tax is resolved and stored on it at write time",
  userCompanyAccess: "scope membership changes the cache KEY (its scope segment), not a row inside an entry",
  userRoles: "as above, through the session's permissions",
  roles: "permission names, not list data",
  rolePermissions: "as above",
  whatsappMessages: "read directly by the messaging log, never through a cached page-read model",
};

function tableToDomains(): Map<string, Set<ReadDomain>> {
  const byTable = new Map<string, Set<ReadDomain>>();
  for (const [domain, tables] of Object.entries(READ_DEPENDS_ON)) {
    for (const table of tables) {
      const set = byTable.get(table) ?? new Set<ReadDomain>();
      set.add(domain as ReadDomain);
      byTable.set(table, set);
    }
  }
  return byTable;
}

// Read out of the schema rather than imported: this check runs in check:offline
// and is a source scanner throughout, so the enum stays the single source of
// truth without dragging Drizzle in.
function documentTypeCodes(): string[] {
  const src = fs.readFileSync(path.join(process.cwd(), "lib/db/schema.ts"), "utf8");
  const block = src.match(/documentTypeCodeEnum = pgEnum\("document_type_code", \[([\s\S]*?)\]\)/);
  assert.ok(block, "couldn't find documentTypeCodeEnum in lib/db/schema.ts — update the regex here");
  const codes = [...block[1].matchAll(/"([A-Z_]+)"/g)].map((m) => m[1]);
  assert.ok(codes.length >= 15, `documentTypeCodeEnum parsed to ${codes.length} codes, which can't be right`);
  return codes;
}

function checkReadDomainCoverage() {
  const byTable = tableToDomains();
  const allCodes = documentTypeCodes();
  let gaps = 0;
  let checked = 0;

  for (const { file, src } of actionFiles()) {
    if (EXEMPT.has(file)) continue;

    // Which documents this file can be writing. A file that names no code at all
    // gets every domain that shows documents — the sound default, since the regex
    // has no way to narrow it.
    const literals = new Set(allCodes.filter((code) => src.includes(`"${code}"`)));
    const required = new Set<ReadDomain>();

    for (const table of writtenTables(src)) {
      for (const domain of byTable.get(table) ?? []) {
        if (DOCUMENT_TABLES.has(table)) {
          const codes = READ_DOCUMENT_TYPES[domain];
          // An empty list means the domain reaches these tables only through
          // another table's rows (stock and products join document_lines from
          // inventory_transactions), so the write alone requires nothing.
          if (codes.length === 0) continue;
          if (literals.size > 0 && !codes.some((code) => literals.has(code))) continue;
        }
        required.add(domain);
      }
    }

    // adjustSettlementBalance moves a balance in raw SQL, so the write regex sees
    // nothing — but the accounts screen reads exactly that column.
    if (src.includes("adjustSettlementBalance")) required.add(READ_DOMAIN.accounts);
    if (required.size === 0) continue;
    checked++;

    // A domain named inside cachedPageRead() is this file READING that domain,
    // not clearing it. Dropped before the scan so a read can't be mistaken for an
    // invalidation.
    const invalidations = src.replace(/cachedPageRead\(\s*READ_DOMAIN\.\w+/g, "cachedPageRead(");
    const declared = new Set([...invalidations.matchAll(/READ_DOMAIN\.(\w+)/g)].map((m) => m[1]));
    const missing = [...required].filter((domain) => !declared.has(domain)).sort();

    if (missing.length) {
      gaps++;
      console.log(`FAIL ${file}: writes tables read by ${missing.join(", ")} but never invalidates those reads`);
    } else {
      console.log(`ok   ${file.padEnd(22)} clears ${[...required].sort().join(", ")}`);
    }
  }

  assert.equal(gaps, 0, `${gaps} action file(s) write a table behind a cached page read without clearing it`);
  console.log(`\nok  read-domain coverage: ${checked} mutating action file(s), no gaps`);
}

// The two maps the rule above reads from describe the schema, and a schema change
// can leave either of them behind. Exempt files are scanned here on purpose:
// resolve-refs.ts is the only writer of expense_categories, so skipping it would
// report that table as unreachable.
function checkDomainMapsAreCurrent() {
  const written = new Set<string>();
  for (const { src } of actionFiles()) for (const table of writtenTables(src)) written.add(table);

  const unwritten = [...new Set(Object.values(READ_DEPENDS_ON).flat())].filter((table) => !written.has(table)).sort();
  assert.deepEqual(unwritten, [], `READ_DEPENDS_ON names table(s) no action writes: ${unwritten.join(", ")}`);

  const byTable = tableToDomains();
  const unclassified = [...written].filter((table) => !byTable.has(table) && !(table in NO_DOMAIN)).sort();
  assert.deepEqual(
    unclassified,
    [],
    `written table(s) in neither READ_DEPENDS_ON nor NO_DOMAIN: ${unclassified.join(", ")}. ` +
      "Add it to a domain in lib/cache-keys.ts if a cached read selects it, or to NO_DOMAIN with the reason.",
  );

  const stale = Object.keys(NO_DOMAIN).filter((table) => !written.has(table)).sort();
  assert.deepEqual(stale, [], `NO_DOMAIN excuses table(s) nothing writes any more: ${stale.join(", ")}`);

  const overlap = Object.keys(NO_DOMAIN).filter((table) => byTable.has(table)).sort();
  assert.deepEqual(overlap, [], `table(s) both excused and depended on: ${overlap.join(", ")}`);

  console.log(`ok  domain maps current: ${written.size} written table(s), all classified`);
}

async function main() {
  await checkPrimitive();
  console.log("");
  checkInvalidationCoverage();
  console.log("");
  checkReadDomainCoverage();
  console.log("");
  checkDomainMapsAreCurrent();
  console.log("\nall cache checks passed");
  process.exit(0);
}

main();
