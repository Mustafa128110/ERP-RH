import assert from "node:assert/strict";
import { isRecordDraft } from "./record-recovery";

assert.equal(isRecordDraft({ revision: "123", fields: [["name", "Recovered name"], ["name", "Second value"]] }), true);
assert.equal(isRecordDraft({ revision: "123", fields: [] }), true, "an edit can uncheck its only checkbox");
for (const value of [null, "old data", {}, { revision: 123, fields: [] }, { revision: "bad", fields: [] },
  { revision: "123", fields: [["name"]] }, { revision: "123", fields: [["name", 12]] }, { revision: "123", fields: { name: "bad" } }]) {
  assert.equal(isRecordDraft(value), false, "malformed recovery input must not be applied to an editor");
}
console.log("record recovery payload checks passed");
