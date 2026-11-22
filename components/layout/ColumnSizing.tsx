"use client";

import { useEffect } from "react";
import { columnWidthKey } from "@/lib/column-widths";
import { globalColumnWidths } from "@/components/ui/useGlobalColumnWidths";

// Native batch grids and custom cell renderers participate in the same sizing
// registry as DataTable. Measure text, not the existing box (which would grow
// on each observation). Horizontal scrolling keeps every measured column intact.
export function ColumnSizing() {
  useEffect(() => {
    let scheduled = 0;
    const context = document.createElement("canvas").getContext("2d");
    if (!context) return;
    function sizeTables() {
      scheduled = 0;
      const measurements: Record<string, number> = {};
      const tables: { table: HTMLTableElement; columns: { key: string; header: HTMLTableCellElement; cells: HTMLTableCellElement[] }[] }[] = [];
      for (const table of document.querySelectorAll("table")) {
        if (table.closest("[aria-hidden=true],.force-light")) continue;
        const headers = Array.from(table.querySelectorAll<HTMLTableCellElement>(":scope > thead > tr:first-child > th")).filter((header) => getComputedStyle(header).display !== "none");
        if (!headers.length) continue;
        const rows = Array.from(table.tBodies).flatMap((body) => Array.from(body.rows)).filter((row) => !row.hasAttribute("data-virtual-spacer"));
        const columns = headers.map((header, index) => {
          const key = columnWidthKey(header.dataset.columnKey ?? header.textContent?.trim() ?? `column-${index}`);
          const cells = rows.map((row) => Array.from(row.cells).filter((cell) => getComputedStyle(cell).display !== "none")[index]).filter((cell): cell is HTMLTableCellElement => !!cell);
          let width = key === "serial" ? 100 : key ? 80 : 44;
          for (const cell of [header, ...cells]) {
            const style = getComputedStyle(cell);
            context!.font = style.font;
            const values = (cell.innerText ?? "").split("\n");
            for (const control of cell.querySelectorAll<HTMLInputElement | HTMLSelectElement>("input:not([type=hidden]),select")) values.push(control instanceof HTMLSelectElement ? control.selectedOptions[0]?.textContent ?? "" : control.value || control.placeholder);
            const padding = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight) + (cell === header ? 24 : 12);
            for (const value of values) width = Math.max(width, context!.measureText(style.textTransform === "uppercase" ? value.toUpperCase() : value).width + padding);
          }
          measurements[key] = Math.max(measurements[key] ?? 0, Math.ceil(width));
          return { key, header, cells };
        });
        tables.push({ table, columns });
      }
      globalColumnWidths.publish(measurements);
      for (const { table, columns } of tables) {
        let total = 0;
        for (const { key, header, cells } of columns) {
          const width = globalColumnWidths.get(key) || 44;
          total += width;
          for (const cell of [header, ...cells]) { cell.style.width = `${width}px`; cell.style.minWidth = `${width}px`; }
        }
        table.style.width = `${total}px`;
        table.style.minWidth = `${total}px`;
      }
    }
    const schedule = () => { if (!scheduled) scheduled = requestAnimationFrame(sizeTables); };
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    const unsubscribe = globalColumnWidths.subscribe(schedule);
    const onStorage = (event: StorageEvent) => {
      if (event.key !== globalColumnWidths.storageKey || !event.newValue) return;
      try { globalColumnWidths.publish(JSON.parse(event.newValue)); } catch { /* Ignore damaged browser preferences. */ }
    };
    document.addEventListener("input", schedule, true);
    document.addEventListener("change", schedule, true);
    window.addEventListener("resize", schedule);
    window.addEventListener("storage", onStorage);
    schedule();
    return () => { observer.disconnect(); unsubscribe(); cancelAnimationFrame(scheduled); document.removeEventListener("input", schedule, true); document.removeEventListener("change", schedule, true); window.removeEventListener("resize", schedule); window.removeEventListener("storage", onStorage); };
  }, []);
  return null;
}
