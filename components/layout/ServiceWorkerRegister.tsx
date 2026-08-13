"use client";

import { useEffect } from "react";

// Registers public/sw.js once, after the first load. Production only: in dev
// the service worker would fight the dev server's module pipeline and hold
// stale bundles.
//
// A failed registration is ignored on purpose — the app works fine without a
// service worker; it's just faster with one.
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;
    const onLoad = () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // No offline support on this browser/network — not worth alarming anyone.
      });
    };
    window.addEventListener("load", onLoad);
    return () => window.removeEventListener("load", onLoad);
  }, []);

  return null;
}
