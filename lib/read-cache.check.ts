import assert from "node:assert/strict";
import { stableReadKey } from "./read-cache";

async function main() {
  assert.equal(stableReadKey({ to: "2026-01-31", from: "2026-01-01", empty: "" }), '{"from":"2026-01-01","to":"2026-01-31"}');
  assert.equal(stableReadKey({ from: "2026-01-01", to: "2026-01-31" }), stableReadKey({ to: "2026-01-31", from: "2026-01-01" }));
  console.log("read cache checks passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
