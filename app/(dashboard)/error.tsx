"use client";

import { useEffect, useState } from "react";
import { primaryActionClass, secondaryActionClass } from "@/components/ui/form-styles";

// What a page shows when its data didn't load. Before this, a database that
// blinked (a DNS wobble, a dropped connection) put a red stack trace over the
// whole app — which reads as "everything is broken and whatever I just did is
// gone", when the truth is usually "try that again in a second".
//
// The distinction the copy has to make: a save that returned already *saved*.
// The failure below happens while re-reading the page after it, so the record is
// in the database whatever this screen says. Nothing typed and not yet saved is
// lost either — the sale and purchase forms keep a local draft (lib/draft.ts)
// and offer it back on the way in.
export default function DashboardError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    console.error(error);
    // Clear old cache generations left by earlier builds. Current service
    // workers never cache authenticated pages or RSC payloads.
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.getRegistration().then((registration) => {
        registration?.active?.postMessage({ type: "erp:clear-cache" });
      });
    }
  }, [error]);

  // A name for the two failures worth telling apart. Everything else is "it
  // didn't load", because a guess dressed up as a diagnosis is worse than none.
  const offline = /EAI_AGAIN|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|fetch failed|Failed query/i.test(
    `${error.message} ${String(error.cause ?? "")}`,
  );

  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="flex w-full max-w-lg flex-col gap-4 rounded-lg border border-sand bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-1">
          <h1 className="text-lg font-semibold text-navy-800">
            {offline ? "Couldn't reach the database" : "This page didn't load"}
          </h1>
          <p className="text-sm text-steel">
            {offline
              ? "The connection dropped for a moment. Nothing you saved is affected — anything that reported success is already stored."
              : "Something went wrong loading this page. Nothing you saved is affected."}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setRetrying(true);
              reset();
            }}
            className={primaryActionClass}
          >
            {retrying ? "Retrying…" : "Try again"}
          </button>
          <button type="button" onClick={() => window.location.reload()} className={secondaryActionClass}>
            Reload the page
          </button>
        </div>

        {/* The digest is what ties this screen to the server log line. */}
        {error.digest && <p className="text-xs text-steel">Reference: {error.digest}</p>}
      </div>
    </div>
  );
}
