import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// Three palettes now live in app/globals.css and they have to stay in step:
//
//   :root[data-theme="dark"]   the dark theme
//   .force-light               documents that leave the app — an invoice PNG in
//                              a customer's chat, a printed ledger sheet
//   @media print               anything sent to paper while in dark mode
//
// The failure this exists to stop is quiet and one-directional: add a token to
// the dark block, forget the other two, and that single colour stays dark
// inside an otherwise white invoice. Nobody sees it until a customer does.
//
// So: every variable the dark block overrides MUST be restored by both of the
// others, and restored to the value the light theme actually uses.
//
//   npx tsx lib/theme.check.ts

type Vars = Map<string, string>;

// Pulls one brace-balanced rule body out by its selector text. A regex for the
// whole rule would stop at the first "}" — these blocks contain none, but the
// @media wrapper does, so the depth counting is not decorative.
function block(css: string, selector: string): string {
  const at = css.indexOf(selector);
  assert.notEqual(at, -1, `couldn't find "${selector}" in globals.css`);
  const open = css.indexOf("{", at);
  assert.notEqual(open, -1, `"${selector}" has no body`);

  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}") {
      depth--;
      if (depth === 0) return css.slice(open + 1, i);
    }
  }
  throw new Error(`unbalanced braces after "${selector}"`);
}

function colorVars(body: string): Vars {
  const found: Vars = new Map();
  for (const m of body.matchAll(/(--color-[\w-]+)\s*:\s*([^;]+);/g)) {
    found.set(m[1], m[2].trim().toLowerCase());
  }
  return found;
}

function main() {
  const css = fs.readFileSync(path.join(process.cwd(), "app/globals.css"), "utf8");

  // The light theme as Tailwind emits it — the @theme block is the source of
  // truth every restore is measured against.
  const light = colorVars(block(css, "@theme {"));
  assert.ok(light.size > 20, `expected the light @theme block to define many colours, found ${light.size}`);

  const dark = colorVars(block(css, ':root[data-theme="dark"] {'));
  assert.ok(dark.size > 20, `expected the dark block to override many colours, found ${dark.size}`);

  const forced = colorVars(block(css, ".force-light,"));
  const printed = colorVars(block(css, "@media print {"));

  console.log(`light @theme: ${light.size} · dark: ${dark.size} · .force-light: ${forced.size} · print: ${printed.size}`);

  // 1. Every dark override is undone in both light-forcing scopes.
  for (const [name] of dark) {
    assert.ok(forced.has(name), `.force-light does not restore ${name} — it would stay dark inside an exported document`);
    assert.ok(printed.has(name), `@media print does not restore ${name} — it would stay dark on paper`);
  }
  console.log(`ok   all ${dark.size} dark override(s) are restored by .force-light and @media print`);

  // 2. Restored to the LIGHT value, not merely to some value. A typo here is a
  //    document that is light but subtly the wrong colour.
  for (const [name, value] of forced) {
    const expected = light.get(name);
    if (expected === undefined) continue; // alias defined only in the dark/forced sets
    assert.equal(value, expected, `.force-light sets ${name} to ${value}, but the light theme uses ${expected}`);
  }
  for (const [name, value] of printed) {
    const expected = light.get(name);
    if (expected === undefined) continue;
    assert.equal(value, expected, `@media print sets ${name} to ${value}, but the light theme uses ${expected}`);
  }
  console.log("ok   every restored value matches the light theme exactly");

  // 3. The dark theme actually changes things — a block that had drifted into
  //    restating the light values would pass everything above and do nothing.
  const changed = [...dark].filter(([name, value]) => light.get(name) !== undefined && light.get(name) !== value);
  assert.ok(changed.length > 15, `the dark theme only changes ${changed.length} colour(s) — is it still a theme?`);
  console.log(`ok   dark theme genuinely differs from light in ${changed.length} colour(s)`);

  // 4. The scrim is the one colour that must NOT invert: it is the wash behind
  //    a modal, and a pale one lights up what it is meant to be pushing back.
  assert.ok(!dark.has("--color-scrim"), "--color-scrim must keep its light value in dark mode");
  console.log("ok   scrim stays dark in both themes");

  console.log("\nall theme checks passed");
}

main();
