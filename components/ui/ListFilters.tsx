"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { DateRangeFilter } from "@/components/ui/DateRangeFilter";

// h-11 on a phone: 44px is the smallest comfortable tap target, and these
// controls sit close together.
const controlClass = "h-11 w-full rounded-md border border-sand bg-transparent px-3 text-base text-ink focus:border-navy-800 sm:h-10 sm:text-sm";

// A name search plus a date range, both driven by query params so the list stays
// a server render and a filtered view is a shareable URL. Extra per-page selects
// (company, direction, …) go in as children — Clear wipes the whole query string,
// so they reset with everything else.
//
// The dates live behind one button (DateRangeFilter), which applies both ends in
// a single navigation. The name is debounced instead — navigating per keystroke
// would fire a request per letter.
//
// Started life as the sales page's customer filter; payments needed the same
// three controls under a different param name, so it took props instead of
// growing a near-identical twin.
export function ListFilters({
  nameParam,
  namePlaceholder,
  children,
}: {
  // Omit both and the bar is a date range plus whatever children it's given —
  // the reports have nothing to search by name, and a text box that filters on
  // a param nothing reads is worse than no box.
  nameParam?: string;
  namePlaceholder?: string;
  children?: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [name, setName] = useState(nameParam ? (searchParams.get(nameParam) ?? "") : "");

  function withParam(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(key, value);
    else params.delete(key);
    return params.size > 0 ? `${pathname}?${params.toString()}` : pathname;
  }

  // Only pushes when the debounced value actually differs from the URL, so a
  // back/forward navigation doesn't get immediately overwritten.
  useEffect(() => {
    if (!nameParam) return;
    const current = searchParams.get(nameParam) ?? "";
    if (name === current) return;
    const timer = window.setTimeout(() => router.push(withParam(nameParam, name)), 300);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, searchParams]);

  return (
    <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
      {nameParam && (
        <input
          type="search"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={namePlaceholder}
          aria-label={`Filter by ${(namePlaceholder ?? "name").toLowerCase()}`}
          className={`${controlClass} sm:w-44`}
        />
      )}
      {children}
      <DateRangeFilter />
      {searchParams.size > 0 && (
        <button
          type="button"
          onClick={() => {
            setName("");
            router.push(pathname);
          }}
          className="text-sm font-medium text-steel hover:text-navy-800"
        >
          Clear
        </button>
      )}
    </div>
  );
}
