"use client";

import { setClientUserId } from "@/lib/client-user";

// Hands the session's user id to the client-side store (lib/client-user.ts) so
// the local persistence layer — drafts, the outbox, the reference cache — can
// be keyed per user. Rendered by the dashboard layout, which is the one server
// component that already knows who is logged in.
//
// The id is set during the render pass, not in an effect, on purpose: effects
// run bottom-up, so a form deeper in the tree would run its own mount effects
// (including the draft's save-on-mount) before this one ran — and would compose
// its draft key as unscoped for that first write. The layout renders before its
// children, so by the time any form renders, the id is already here.
//
// The server also renders this component, and a server module variable must not
// be mutated (it would leak between requests), so the assignment is guarded to
// the browser. On the server nothing is set, which is correct: the server never
// writes or reads drafts (lib/draft.ts returns null there).
export function SessionSeed({ userId }: { userId: string }) {
  if (typeof window !== "undefined") {
    // Idempotent: same id on re-render (StrictMode, a parent re-render) is a
    // no-op, and a *different* id means someone else logged in — the store
    // switches, so the next form mounts compose keys under the new user.
    setClientUserId(userId);
  }
  return null;
}
