"use client";

import { useSyncExternalStore } from "react";

// The session lives server-side (lib/auth/session.ts); the client has no direct
// read. But the local persistence layer (drafts, the outbox, the reference
// cache) must be isolated per user — User B logging in on the same browser must
// not be offered User A's half-typed sale, and must not sync User A's queued
// expenses. The dashboard layout knows who it is, so it renders SessionSeed
// with the id, and this store hands that id to any client component that asks.
//
// The store is a plain module variable rather than React state: the id is set
// once per login (by an effect in SessionSeed) and never changes until the next
// login, so nothing here needs to trigger re-renders beyond the subscribe call
// useSyncExternalStore makes on mount.

let currentUserId: string | null = null;
const listeners = new Set<() => void>();

export function setClientUserId(id: string | null) {
  if (currentUserId === id) return;
  currentUserId = id;
  for (const l of listeners) l();
}

export function getClientUserId(): string | null {
  return currentUserId;
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// Server and the pre-hydration frame both report null — the key a form composes
// before SessionSeed's effect runs is the unscoped one, which is harmless: the
// user cannot have typed anything in the milliseconds before the id lands, so
// nothing is ever written under it.
export function useClientUserId(): string | null {
  return useSyncExternalStore(subscribe, getClientUserId, () => null);
}

// The draft keys, composed at the call site (each form) as the user chose:
// "sale", "sale:<uid>", "sale:<other-uid>" are three different drafts, so a
// shared browser can never offer one user's work to another. The key for a
// logged-out or pre-hydration frame is the unscoped kind; nothing is written
// under it because it only exists before the user can type.
export function scopedDraftKey(kind: string): string {
  const uid = currentUserId;
  return uid ? `${kind}:${uid}` : kind;
}
