"use client";

// One line across the top of every dashboard route while the app is offline.
//
// The Topbar already has the sync pill, and it is the detailed answer: what is
// queued, what failed, what can be retried. This is the other half — the pill is
// seven pixels of text in a corner, and the question someone actually has when
// they press Save on a dropping link is "did that do anything?". With
// experimental.useOffline on, the answer is yes and the button just sits there
// looking frozen, which is worth a sentence in the place they are already
// looking. It renders nothing at all when online, so it costs no rows.
//
// It reads the provider's connectivity rather than calling useOffline() itself:
// one connectivity truth in the app, so the banner and the pill can never
// disagree about whether the shop is offline. See SyncProvider for why that
// value combines two signals.

import { useSync } from "@/components/layout/SyncProvider";

export function OfflineNotice() {
  const { online } = useSync();
  if (online) return null;

  return (
    <div
      role="status"
      className="border-b border-amber-600 bg-amber-100 px-3 py-1.5 text-xs text-amber-900 print:hidden"
    >
      <span className="font-semibold">Offline</span> — you can keep working. A save you start now waits and is
      sent automatically when the connection returns; keep this tab open until it does.
    </div>
  );
}
