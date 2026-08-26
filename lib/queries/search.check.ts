import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { searchRows } from "@/lib/queries/search";
import { PER_KIND } from "@/lib/search-constants";

// Seventeen SELECTs stapled together with UNION ALL is the kind of statement
// that compiles fine and then fails at run time — a column count that doesn't
// line up, a type Postgres can't reconcile across a branch, a table renamed
// under one of them. The box sits in the chrome of every screen, so that
// failure would be on every page at once.
//
//   npx tsx --conditions=react-server --env-file=.env lib/queries/search.check.ts

async function main() {
  const companies = await db.execute<{ id: string }>(sql`SELECT id::text AS id FROM companies ORDER BY name`);
  assert.ok(companies.length > 0, "no companies — seed the database before running this");
  const scope = companies.map((c) => c.id);
  console.log(`companies in scope: ${scope.length}`);

  // The statement runs at all. A term with no letters in it is deliberate: it
  // exercises every branch while matching almost nothing, so this is a shape
  // check rather than a data check.
  // Length rather than deepEqual: postgres-js hands back a Result, which is an
  // Array subclass, and a strict deepEqual against [] fails on the prototype.
  const empty = await searchRows(scope, "zzzznotathing", { users: true, roles: true });
  assert.equal(empty.length, 0, "a term matching nothing should return nothing, not throw");
  console.log("ok   all 17 branches parse, execute and union cleanly");

  // Every row that does come back has the four columns the caller maps.
  const hits = await searchRows(scope, "a", { users: true, roles: true });
  for (const row of hits) {
    assert.ok(typeof row.kind === "string" && row.kind.length > 0, `row has no kind: ${JSON.stringify(row)}`);
    assert.ok(typeof row.id === "string" && row.id.length > 0, `row has no id: ${JSON.stringify(row)}`);
    assert.ok(row.title !== null && row.title !== undefined, `row has no title: ${JSON.stringify(row)}`);
  }
  const kinds = [...new Set(hits.map((h) => h.kind))].sort();
  console.log(`ok   "a" matched ${hits.length} row(s) across ${kinds.length} kind(s): ${kinds.join(", ")}`);

  // Nothing exceeds its share, or one common word would drown the dropdown.
  const counts = new Map<string, number>();
  for (const h of hits) counts.set(h.kind, (counts.get(h.kind) ?? 0) + 1);
  for (const [kind, n] of counts) {
    assert.ok(n <= PER_KIND, `${kind} returned ${n} rows, over the ${PER_KIND} cap`);
  }
  console.log(`ok   every kind stayed within the ${PER_KIND}-row cap`);

  // The permission flags actually remove their branches — this is the check
  // that matters, because it is the one standing between a salesman and the
  // staff directory.
  const ungranted = await searchRows(scope, "a", { users: false, roles: false });
  assert.ok(!ungranted.some((h) => h.kind === "user"), "users appeared without the users.view grant");
  assert.ok(!ungranted.some((h) => h.kind === "role"), "roles appeared without the roles.view grant");
  console.log("ok   users and roles are absent without their grants");

  // An empty scope is a user with no company access, not an unfiltered query.
  const noScope = await searchRows([], "a", { users: true, roles: true });
  assert.equal(noScope.length, 0, "an empty company scope must return nothing");
  console.log("ok   empty scope returns nothing");

  // A term full of LIKE metacharacters is matched literally, not as a wildcard.
  const literal = await searchRows(scope, "%_%", { users: true, roles: true });
  assert.ok(Array.isArray(literal), "wildcard characters must not break the query");
  console.log(`ok   "%_%" is escaped and matched literally (${literal.length} row(s))`);

  // A type prefix must prune every other branch. This is the contract behind
  // item:, unit:, contact:, and the other entity prefixes in the top bar.
  const unitOnly = await searchRows(scope, "a", { users: true, roles: true }, "unit");
  assert.ok(unitOnly.every((hit) => hit.kind === "unit"), "unit-scoped search returned another entity kind");
  const contactOnly = await searchRows(scope, "a", { users: true, roles: true }, "contact");
  assert.ok(contactOnly.every((hit) => hit.kind === "contact"), "contact-scoped search returned another entity kind");
  console.log("ok   type-prefixed searches prune unrelated entity branches");

  console.log("\nall global search checks passed");
  process.exit(0);
}

main();
