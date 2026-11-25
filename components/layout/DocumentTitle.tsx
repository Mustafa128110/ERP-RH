"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { pageLabel } from "@/lib/page-label";

// Metadata is rendered from the root layout for the first dashboard paint;
// this keeps the title aligned with the current route after client navigation.
export function DocumentTitle() {
  const pathname = usePathname();

  useEffect(() => {
    const apply = () => {const expected=pageLabel(pathname);if(document.title!==expected)document.title=expected;};
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(document.head,{childList:true,subtree:true,characterData:true});
    window.addEventListener("pageshow",apply);
    return()=>{observer.disconnect();window.removeEventListener("pageshow",apply);};
  }, [pathname]);

  return null;
}
