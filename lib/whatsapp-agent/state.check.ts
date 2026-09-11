import assert from "node:assert/strict";
import { savePending, takePending, finishPending, clearPending, type PendingDraft } from "./state";

// Unique temporary Redis keys only. No inbound message is sent, no customer
// number is used, and no business action is called.
async function main() {
  const draft: PendingDraft = { phone: `check-${crypto.randomUUID()}`, userId: crypto.randomUUID(), operationId: crypto.randomUUID(), tool: "create_sale", fields: { contactName: "Recovery check" }, confirmation: "Test input only" };
  try {
    assert.equal(await savePending(draft), true);
    assert.deepEqual(await takePending(draft.phone), draft);
    assert.deepEqual(await takePending(draft.phone), draft, "a process restart resumes the identical confirmed command");
    assert.equal(await savePending({ ...draft, operationId: crypto.randomUUID() }), false, "new input must not overwrite a processing command");
    assert.equal(await clearPending(draft.phone), false, "a processing save cannot be reported as cancelled");
    await finishPending(draft.phone, crypto.randomUUID());
    assert.deepEqual(await takePending(draft.phone), draft, "only the matching command can acknowledge this work");
    await finishPending(draft.phone, draft.operationId, true);
    assert.equal(await clearPending(draft.phone), true, "definitively refused work returns to a cancellable draft");
    assert.equal(await takePending(draft.phone), null);
    await savePending(draft);
    const [taken, cancelled] = await Promise.all([takePending(draft.phone), clearPending(draft.phone)]);
    assert.ok(taken ? !cancelled : cancelled, "confirmation and cancellation must have exactly one winner");
    await finishPending(draft.phone, draft.operationId);
    assert.equal(await takePending(draft.phone), null);
    console.log("WhatsApp recovery checks passed: durable handoff, resumed identity, overwrite refusal, acknowledgement ownership and atomic cancellation");
  } finally {
    await finishPending(draft.phone, draft.operationId);
    await clearPending(draft.phone);
  }
}
void main();
