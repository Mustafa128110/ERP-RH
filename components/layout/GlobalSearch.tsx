"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { globalSearch } from "@/lib/actions/search";
import { KIND_LABEL, type SearchHit } from "@/lib/search-constants";

// The top bar's search box. It used to be an <input> attached to nothing at all.
//
// Debounced rather than fired per keystroke: typing "cement" is six renders and
// would otherwise be six queries, five of them thrown away before they land.
// 180ms is under the gap between keystrokes for anyone typing at speed, so the
// request goes out once, when they pause.
const DEBOUNCE_MS = 180;

// One search box exists per page, so a fixed id is enough to tie the input to
// its result list for screen readers.
const LIST_ID = "global-search-results";

export function GlobalSearch() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  // Every in-flight search carries the sequence it was started at; a slow reply
  // to an earlier keystroke must not overwrite the results for a later one.
  const seq = useRef(0);

  useEffect(() => {
    const q = query.trim();
    // Cleared in the change handler below, not here: an effect that only wants
    // to schedule a fetch shouldn't also be setting state on the way past.
    if (q.length < 2) return;
    const mine = ++seq.current;
    const timer = window.setTimeout(async () => {
      try {
        const results = await globalSearch(q);
        if (seq.current !== mine) return;
        setHits(results);
        setHighlight(0);
        setOpen(true);
      } catch {
        // A failed search is a quiet no-result, not a broken page — the box sits
        // in the chrome of every screen and must never take one down.
        if (seq.current === mine) setHits([]);
      }
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [query]);

  // Ctrl/Cmd+K from anywhere. The browser's own find stays on Ctrl+F.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function go(hit: SearchHit) {
    setOpen(false);
    setQuery("");
    router.push(hit.href);
  }

  return (
    <div className="relative min-w-0 flex-1">
      <input
        ref={inputRef}
        type="search"
        value={query}
        onChange={(e) => {
          const next = e.target.value;
          setQuery(next);
          // Too short to search: drop whatever the last query found rather than
          // leaving stale results hanging under a half-deleted term.
          if (next.trim().length < 2) {
            setHits([]);
            setOpen(false);
          }
        }}
        onFocus={() => hits.length > 0 && setOpen(true)}
        // Delayed so a click on a result registers before the list unmounts.
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
        onKeyDown={(e) => {
          if (!open || hits.length === 0) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setHighlight((h) => Math.min(h + 1, hits.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setHighlight((h) => Math.max(h - 1, 0));
          } else if (e.key === "Enter") {
            e.preventDefault();
            go(hits[highlight]);
          } else if (e.key === "Escape") {
            e.preventDefault();
            setOpen(false);
          }
        }}
        placeholder="Search everything…   Ctrl+K"
        aria-label="Search everything"
        role="combobox"
        aria-expanded={open}
        aria-controls={LIST_ID}
        aria-autocomplete="list"
        className="w-full rounded-md border border-zinc-300 bg-transparent px-3 py-1.5 text-sm text-zinc-700 placeholder:text-zinc-400 dark:border-zinc-700 dark:text-zinc-300"
      />

      {open && (
        <ul
          id={LIST_ID}
          className="scroll-thin absolute left-0 top-full z-50 mt-1 max-h-96 w-full overflow-auto rounded-md border border-sand bg-white py-1 text-sm shadow-xl"
        >
          {hits.length === 0 ? (
            <li className="px-3 py-2 text-steel">Nothing matches “{query.trim()}”.</li>
          ) : (
            hits.map((hit, i) => (
              <li key={`${hit.kind}:${hit.id}`}>
                <button
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    go(hit);
                  }}
                  onMouseEnter={() => setHighlight(i)}
                  className={`flex w-full items-baseline justify-between gap-3 px-3 py-2 text-left ${
                    i === highlight ? "bg-navy-800 text-white" : "text-ink hover:bg-ivory"
                  }`}
                >
                  <span className="min-w-0 flex-1 truncate">
                    {hit.title}
                    {hit.subtitle && <span className={`ml-2 text-xs ${i === highlight ? "text-white/70" : "text-steel"}`}>{hit.subtitle}</span>}
                  </span>
                  <span className={`shrink-0 text-xs ${i === highlight ? "text-white/70" : "text-steel"}`}>{KIND_LABEL[hit.kind]}</span>
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
