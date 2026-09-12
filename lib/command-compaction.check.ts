import assert from "node:assert/strict";
import { compactionCandidates, commandInputHash } from "./command-compaction";
import type { SavedCommand } from "./command-protocol";

async function main() {
  const now = 20 * 86400_000;
  const rows: SavedCommand[] = Array.from({ length: 110 }, (_, i) => ({ id: String(i), userId: "a", action: "sales.createSale", args: [{ value: i }], path: "/sales", label: "Sale", version: 1, createdAt: i, updatedAt: i, status: "confirmed", attempts: 1, result: { id: `saved-${i}` } }));
  const unresolved: SavedCommand[] = ["pending", "syncing", "failed", "cancelled"].map(status => ({ ...rows[0], id: status, status: status as SavedCommand["status"] }));
  assert.equal(compactionCandidates([...rows, ...unresolved], now).length, 10);
  assert.ok(compactionCandidates([...rows, ...unresolved], now).every(row => row.status === "confirmed"));
  assert.equal(compactionCandidates(rows, 1000).length, 0, "recent confirmed input remains intact");
  assert.equal(await commandInputHash([{ a: 1, b: 2 }]), await commandInputHash([{ b: 2, a: 1 }]));
  assert.notEqual(await commandInputHash([1]), await commandInputHash([2]));
  console.log("Confirmed-command compaction policy checks passed");
}
void main();
