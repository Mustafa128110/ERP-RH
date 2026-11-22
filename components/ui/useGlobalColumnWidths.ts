"use client";

import { useEffect, useState, useSyncExternalStore, type RefObject } from "react";
import { columnWidthKey, createColumnLayout, fittedColumnWidth, minimumColumnWidth } from "@/lib/column-widths";
import type { ColumnDef, Row } from "@/lib/table";

// v1 mixed fixed page widths into content measurements. Start with actual minima.
const STORAGE = "erp:global-column-widths:v2";
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

export function useGlobalColumnWidths(columns: ColumnDef[], rows: Row[]) {
  // Page-specific width hints are excluded: only content measurements are shared.
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
      const texts = key === "serial" ? [rows.length] : rows.map((row) => row[column.key]).filter((value) => typeof value === "string" || typeof value === "number");
      const measured = fittedColumnWidth(context.measureText(column.label.toUpperCase()).width, texts.map((value) => context.measureText(String(value)).width), minimumColumnWidth(key));
      if (measured > (next[key] ?? 0)) { next[key] = measured; changed = true; }
    }
    if (changed) {
      widths = next;
      try { localStorage.setItem(STORAGE, JSON.stringify(widths)); } catch { /* In-memory global sizing remains available. */ }
      for (const listener of listeners) listener();
    }
  }, [columns, rows]);
  return (column: ColumnDef) => Math.max(minimumColumnWidth(column.key), shared[columnWidthKey(column.key)] ?? 0);
}

const mobileSnapshot = () => window.matchMedia("(max-width: 767px)").matches;
const desktopSnapshot = () => false;
function subscribeMobile(listener: () => void) {
  const media = window.matchMedia("(max-width: 767px)");
  media.addEventListener("change", listener);
  return () => media.removeEventListener("change", listener);
}

export function useTableColumnLayout(columns: ColumnDef[], rows: Row[], container: RefObject<HTMLElement | null>, selectable = false) {
  const getMinimum = useGlobalColumnWidths(columns, rows);
  const mobile = useSyncExternalStore(subscribeMobile, mobileSnapshot, desktopSnapshot);
  const [availableWidth, setAvailableWidth] = useState(0);
  const hasRows = rows.length > 0;
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const measure = () => {
      const style = getComputedStyle(element);
      setAvailableWidth(Math.max(0, element.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)));
    };
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    measure();
    return () => observer.disconnect();
  // A first record replaces DataTable's empty placeholder with the scroll area.
  }, [container, hasRows]);
  const visible = columns.filter(column => !mobile || !column.hideOnMobile);
  const layoutColumns = [...(selectable ? [{key: "__select", minimum: 48}] : []), ...visible.map(column => ({key: column.key, minimum: getMinimum(column)}))];
  const layout = createColumnLayout(layoutColumns, availableWidth);
  const widths = new Map(layoutColumns.map((column, index) => [column.key, layout.widths[index]]));
  return {minimumWidth: layout.minimumWidth, tableWidth: layout.tableWidth, getWidth: (column: ColumnDef) => widths.get(column.key) ?? "0px"};
}
