// Client-safe constants for the duplicate-operation protocol. The claim/refusal
// machinery lives in lib/actions/operation-id.ts and stays server-only; the
// outbox engine runs in the browser and must recognise "already recorded" as
// *confirmed* (the first attempt landed, the response was lost) rather than as
// a failure to keep retrying. That recognition needs the exact sentence, so the
// sentence lives here where both sides can import it.

export const DUPLICATE_OPERATION_MESSAGE =
  "This save was already recorded — the first click went through even if you never saw the confirmation. Check the list before saving again.";

export const OPERATION_ID_FIELD = "operationId";
