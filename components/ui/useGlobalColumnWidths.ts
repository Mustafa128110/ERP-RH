"use client";

import { useEffect, useSyncExternalStore } from "react";
import { columnWidthKey, fittedColumnWidth } from "@/lib/column-widths";
import type { ColumnDef, Row } from "@/lib/table";

const STORAGE = "erp:global-column-widths:v1";
let widths: Record<string, number> = {};
const empty: Record<string, number> = {};
const listeners = new Set<() => void>();
let loaded = false;
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const snapshot = () => widths;
const serverSnapshot = () => empty;

export const globalColumnWidths = {
  storageKey: STORAGE,
  subscribe,
  get(key: string) { return widths[columnWidthKey(key)] ?? 0; },
  publish(measured: Record<string, number>) {
    const next = { ...widths };
    let changed = false;
    for (const [key, value] of Object.entries(measured)) {
      const canonical = columnWidthKey(key);
      if (Number.isFinite(value) && value > (next[canonical] ?? 0)) { next[canonical] = Math.ceil(value); changed = true; }
    }
    if (!changed) return;
    widths = next;
    try { localStorage.setItem(STORAGE, JSON.stringify(widths)); } catch { /* In-memory sharing still works. */ }
    for (const listener of listeners) listener();
  },
};

export function useGlobalColumnWidths(columns: ColumnDef[], rows: Row[], fallback: (column: ColumnDef) => number) {
  const shared = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  useEffect(() => {
    let changed = false;
    const next = { ...widths };
    if (!loaded) {
      loaded = true;
      try {
        const saved = JSON.parse(localStorage.getItem(STORAGE) ?? "{}");
        for (const [key, value] of Object.entries(saved)) if (typeof value === "number" && Number.isFinite(value) && value >= 40) next[key] = Math.max(next[key] ?? 0, value);
        changed = true;
      } catch { /* Automatic fitting still works without browser persistence. */ }
    }
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) return;
    const scale = parseFloat(getComputedStyle(document.documentElement).fontSize) / 16;
    context.font = `${14 * scale}px ${getComputedStyle(document.body).fontFamily}`;
    for (const column of columns) {
      const key = columnWidthKey(column.key);
      const texts = rows.map((row) => row[column.key]).filter((value) => typeof value === "string" || typeof value === "number");
      const measured = fittedColumnWidth(context.measureText(column.label.toUpperCase()).width, texts.map((value) => context.measureText(String(value)).width), key === "serial" ? 100 : fallback(column));
      if (measured > (next[key] ?? 0)) { next[key] = measured; changed = true; }
    }
    if (changed) {
      widths = next;
      try { localStorage.setItem(STORAGE, JSON.stringify(widths)); } catch { /* In-memory global sizing remains available. */ }
      for (const listener of listeners) listener();
    }
  }, [columns, rows, fallback]);
  return (column: ColumnDef) => Math.max(fallback(column), shared[columnWidthKey(column.key)] ?? 0);
}
