// Local drafts preserve in-progress document and batch input on this device.
//
// A server action that fails keeps its form's state, so that case was never the
// problem. The one that loses work is a *render* that throws — a database blip
// while the page reloads after a save, say — because the error boundary replaces
// the tree and every line typed goes with it. A copy in localStorage outlives
// that, and a browser closed by accident too.
//
// Not a sync feature and not a queue: the draft is what was on screen, on this
// machine. It is cleared after an acknowledged transfer to the durable queue
// or a confirmed server save.

const PREFIX = "erp-draft:";
export const DRAFT_STATUS_EVENT = "erp:draft-storage-status";
const failedDrafts = new Set<string>();
export function draftStorageFailures(): string[] { return [...failedDrafts]; }
function storageStatus(key: string, failed: boolean) {
  if (failed) failedDrafts.add(key); else failedDrafts.delete(key);
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(DRAFT_STATUS_EVENT, { detail: { key, failed } }));
}
// Unsubmitted work has no automatic expiry. Only explicit discard or an
// acknowledged transfer to the durable queue/server can remove it.

type Envelope<T> = { savedAt: number; value: T; operationId?: string };
export function draftOperationId(key: string): string | undefined {
  try { return (JSON.parse(localStorage.getItem(`${PREFIX}${key}`) ?? "null") as Envelope<unknown> | null)?.operationId; }
  catch { return undefined; }
}

// Every call is wrapped: localStorage throws in private mode and when the quota
// is full, and a draft failing to save must never take the form down with it.
// The boolean return lets a caller that promises durability (a crash-draft for
// a batch grid) say so out loud instead of silently claiming the work is safe.
export function saveDraft(key: string, value: unknown): boolean {
  try {
    const raw = localStorage.getItem(`${PREFIX}${key}`);
    if (raw) {
      const prior = JSON.parse(raw);
      if (!prior || typeof prior !== "object" || !("value" in prior)) throw new Error("Unreadable draft");
    }
    const operationId = draftOperationId(key) ?? crypto.randomUUID();
    localStorage.setItem(`${PREFIX}${key}`, JSON.stringify({ savedAt: Date.now(), value, operationId } satisfies Envelope<unknown>));
    storageStatus(key, false);
    return true;
  } catch {
    storageStatus(key, true);
    return false;
  }
}

export function readDraft<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(`${PREFIX}${key}`);
    if (!raw) return null;
    const envelope = JSON.parse(raw) as Envelope<T>;
    if (!envelope || typeof envelope.savedAt !== "number" || !("value" in envelope)) {
      return null;
    }
    return envelope.value;
  } catch {
    // Written by an older version of the form, or half-written. Either way it
    // can't be restored, so it shouldn't keep being offered.
    // Preserve unreadable bytes for recovery rather than deleting user input.
    return null;
  }
}

export function clearDraft(key: string): void {
  snapshots.delete(key);
  try {
    localStorage.removeItem(`${PREFIX}${key}`);
    storageStatus(key, false);
  } catch {
    storageStatus(key, true);
  }
}

// --- Reading a draft from a component --------------------------------------
//
// A form can't read localStorage while rendering: the server renders it too, and
// a first client render that disagrees with the server's HTML is a hydration
// error. useSyncExternalStore is the way through — null on the server, the draft
// on the client, React reconciling the two after hydration.
//
// The snapshot is read once per key and then held, because getSnapshot runs on
// every render: re-reading would hand back a new object each time (an infinite
// render loop), and worse, the draft being written as the user types would make
// the "you have an unsaved sale" banner appear mid-sentence. What the form is
// offered is the draft as it stood when the form opened, which is the only
// version anybody wants back.
const snapshots = new Map<string, unknown>();

// Nothing pushes updates: the value is fixed for the life of the mount.
export const subscribeDraft = () => () => {};

export function draftSnapshot<T>(key: string): T | null {
  if (!snapshots.has(key)) snapshots.set(key, readDraft<T>(key));
  return (snapshots.get(key) as T | null) ?? null;
}

// The server has no localStorage, so it has no draft. Must be a stable
// reference — a fresh `null` is fine, a fresh `{}` would loop.
export const noDraft = () => null;

export function resetDraftSnapshot(key: string): void { snapshots.delete(key); }
