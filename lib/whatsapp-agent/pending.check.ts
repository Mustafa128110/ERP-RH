import assert from "node:assert/strict";
import { PendingStore } from "./pending";

// The two properties that keep a draft from posting twice or posting late.
//
//   npx tsx lib/whatsapp-agent/pending.check.ts

const TTL = 1000;
const store = new PendingStore<string>(TTL);
const t0 = 0;

// --- Taking consumes -----------------------------------------------------
// WhatsApp redelivers messages. If "yes" could be read twice, a redelivery
// would post the same invoice twice.
store.set("923001", "sale-A", t0);
assert.equal(store.take("923001", t0), "sale-A");
assert.equal(store.take("923001", t0), null, "a draft posts exactly once");

// --- Expiry --------------------------------------------------------------
store.set("923001", "sale-B", t0);
assert.equal(store.has("923001", t0 + TTL - 1), true);
assert.equal(store.take("923001", t0 + TTL + 1), null, "an expired draft never posts");

// Expiry also drops it, so it can't come back at an earlier clock reading.
store.set("923001", "sale-C", t0);
assert.equal(store.has("923001", t0 + TTL + 1), false);
assert.equal(store.take("923001", t0), null);

// --- A new draft replaces the old ---------------------------------------
// Starting to describe a different sale abandons the previous one; a later
// "yes" must mean the newest thing said, never a stale one.
store.set("923001", "sale-D", t0);
store.set("923001", "sale-E", t0);
assert.equal(store.take("923001", t0), "sale-E");

// --- Threads don't cross -------------------------------------------------
store.set("923001", "mine", t0);
store.set("923002", "yours", t0);
assert.equal(store.take("923002", t0), "yours");
assert.equal(store.take("923001", t0), "mine");

// --- Sweep releases abandoned drafts ------------------------------------
store.set("a", "1", t0);
store.set("b", "2", t0);
assert.equal(store.size, 2);
store.sweep(t0 + TTL + 1);
assert.equal(store.size, 0, "abandoned drafts don't leak until restart");

// clear() cancels without posting — what "no" does.
store.set("c", "3", t0);
store.clear("c");
assert.equal(store.has("c", t0), false);

console.log("whatsapp pending store checks passed");
