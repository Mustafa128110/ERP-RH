// Local drafts for the two forms someone spends real time typing into: a sale
// and a stock purchase.
//
// A server action that fails keeps its form's state, so that case was never the
// problem. The one that loses work is a *render* that throws — a database blip
// while the page reloads after a save, say — because the error boundary replaces
// the tree and every line typed goes with it. A copy in localStorage outlives
// that, and a browser closed by accident too.
//
// Not a sync feature and not a queue: the draft is what was on screen, on this
// machine. It's cleared the moment the real record saves.

const PREFIX = "erp-draft:";
// A week-old draft is not a draft, it's clutter someone abandoned. Offering it
// back is worse than dropping it.
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

type Envelope<T> = { savedAt: number; value: T };

// Every call is wrapped: localStorage throws in private mode and when the quota
// is full, and a draft failing to save must never take the form down with it.
export function saveDraft(key: string, value: unknown): void {
  try {
    localStorage.setItem(`${PREFIX}${key}`, JSON.stringify({ savedAt: Date.now(), value } satisfies Envelope<unknown>));
  } catch {
    // No draft is better than a broken form.
  }
}

export function readDraft<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(`${PREFIX}${key}`);
    if (!raw) return null;
    const envelope = JSON.parse(raw) as Envelope<T>;
    if (!envelope || typeof envelope.savedAt !== "number" || Date.now() - envelope.savedAt > MAX_AGE_MS) {
      clearDraft(key);
      return null;
    }
    return envelope.value;
  } catch {
    // Written by an older version of the form, or half-written. Either way it
    // can't be restored, so it shouldn't keep being offered.
    clearDraft(key);
    return null;
  }
}

export function clearDraft(key: string): void {
  snapshots.delete(key);
  try {
    localStorage.removeItem(`${PREFIX}${key}`);
  } catch {
    // Nothing to do — a draft that won't delete is offered once more and then
    // ages out.
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
