import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// One narrow rule, for one failure that nothing else catches.
//
// AGENTS.md: a "use server" module exports async functions only. In practice
// the compiler erases `export interface X {}` and `export type X = …` before
// Next ever sees them, which is why ~30 action files carry those happily. The
// form that does NOT survive is the two-step re-export:
//
//     import { thing, type Thing } from "./somewhere";
//     export type { Thing };            // ← this one
//
// Next's server-actions loader re-exports every export of a "use server" module
// by name. It does not know `Thing` was type-only, so it emits a reference to a
// binding the compiler already deleted, and the module throws
// "ReferenceError: Thing is not defined" at evaluation — taking down every
// route that imports any action from that file.
//
// tsc passes. eslint passes. `next build` passes. It fails only when the route
// is actually requested, which is why it needs a check of its own.
//
// The inline form `export type { Thing } from "./somewhere";` is fine and is
// already used (lib/actions/products.ts) — it is unambiguously type-only at
// parse time, so it is elided rather than re-exported.
//
//   npx tsx lib/actions/server-exports.check.ts

// `export type { … }` with no `from` clause before the semicolon.
const BARE_TYPE_REEXPORT = /^\s*export\s+type\s*\{[^}]*\}\s*;/gm;

function main() {
  const dir = path.join(process.cwd(), "lib/actions");
  const offenders: string[] = [];
  let scanned = 0;

  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith(".ts") || file.endsWith(".check.ts")) continue;
    const src = fs.readFileSync(path.join(dir, file), "utf8");
    // Only "use server" modules are affected; a plain module re-exports types
    // without anyone re-exporting them by name afterwards.
    if (!/^\s*["']use server["']/.test(src)) continue;
    scanned++;

    for (const match of src.matchAll(BARE_TYPE_REEXPORT)) {
      const line = src.slice(0, match.index).split("\n").length;
      offenders.push(`${file}:${line}  ${match[0].trim()}`);
    }
  }

  for (const o of offenders) console.log(`FAIL ${o}`);
  assert.equal(
    offenders.length,
    0,
    `${offenders.length} bare "export type { … }" in a "use server" module — move the type to a sibling constants file (lib/*-constants.ts) and import it from there`,
  );

  console.log(`ok   ${scanned} "use server" module(s), no bare type re-exports`);
  console.log("\nall server export checks passed");
}

main();
