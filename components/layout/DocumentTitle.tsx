"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { pageLabel } from "@/lib/page-label";

// Metadata is rendered from the root layout for the first dashboard paint;
// this keeps the title aligned with the current route after client navigation.
export function DocumentTitle() {
  const pathname = usePathname();

  useEffect(() => {
    document.title = pageLabel(pathname);
  }, [pathname]);

  return null;
}
