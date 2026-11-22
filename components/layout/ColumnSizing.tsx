"use client";

import { useEffect } from "react";
import { columnWidthKey, createColumnLayout, minimumColumnWidth, TABLE_COLUMN_GUTTER } from "@/lib/column-widths";
import { globalColumnWidths } from "@/components/ui/useGlobalColumnWidths";

// Native batch grids and custom cell renderers participate in the same sizing
// registry as DataTable. Measure text, not the existing box (which would grow
// on each observation). Horizontal scrolling keeps every measured column intact.
export function ColumnSizing() {
  useEffect(() => {
    let scheduled = 0;
    let active = true;
    const context = document.createElement("canvas").getContext("2d");
    if (!context) return;
    const watched = new Set<Element>();
    function measure(cell: HTMLTableCellElement, header: boolean) {
      const style = getComputedStyle(cell);
      context!.font = style.font || `${style.fontSize} ${style.fontFamily}`;
      const padding = TABLE_COLUMN_GUTTER * 2;
      const nestedPadding = Math.max(0, ...Array.from(cell.querySelectorAll<HTMLElement>("span,a,button")).map(element => {
        const nested = getComputedStyle(element);
        return parseFloat(nested.paddingLeft) + parseFloat(nested.paddingRight);
      }));
      const text = (cell.innerText ?? "").replace(/[↑↓]\s*\d+/g, "");
      let width = Math.max(0, ...text.split("\n").map(value => context!.measureText(style.textTransform === "uppercase" ? value.toUpperCase() : value).width)) + padding + nestedPadding + (header && text.trim() ? 28 : 8);
      const icons = Array.from(cell.querySelectorAll<SVGElement>("svg"));
      width += icons.reduce((sum, icon) => sum + icon.getBoundingClientRect().width + 4, 0);
      const groups = new Map<HTMLElement, number[]>();
      for (const control of cell.querySelectorAll<HTMLInputElement | HTMLSelectElement>("input:not([type=hidden]),select")) {
        const controlStyle = getComputedStyle(control);
        context!.font = controlStyle.font || `${controlStyle.fontSize} ${controlStyle.fontFamily}`;
        const value = control instanceof HTMLSelectElement ? control.selectedOptions[0]?.textContent ?? "" : control.value || control.placeholder;
        const chrome = control instanceof HTMLSelectElement || control.type === "number" ? 24 : 4;
        const content = control.type === "checkbox" ? 16 : context!.measureText(value).width;
        const intrinsic = Math.max(content + parseFloat(controlStyle.paddingLeft) + parseFloat(controlStyle.paddingRight) + chrome, parseFloat(controlStyle.minWidth) || 0);
        width = Math.max(width, padding + intrinsic);
        const parent = control.parentElement!;
        const parentStyle = getComputedStyle(parent);
        if (parent !== cell && parentStyle.display === "flex" && parentStyle.flexDirection.startsWith("row")) groups.set(parent, [...groups.get(parent) ?? [], intrinsic]);
      }
      for (const [group, controls] of groups) width = Math.max(width, padding + controls.reduce((sum, value) => sum + value, 0) + (parseFloat(getComputedStyle(group).columnGap) || 0) * (controls.length - 1));
      return Math.ceil(width);
    }
    function sizeTables() {
      scheduled = 0;
      const measurements: Record<string, number> = {};
      const tables: { table: HTMLTableElement; columns: { key: string; header: HTMLTableCellElement; cells: HTMLTableCellElement[]; grow?: number }[] }[] = [];
      for (const table of document.querySelectorAll("table")) {
        if (table.closest("[aria-hidden=true],.force-light")) continue;
        const headers = Array.from(table.querySelectorAll<HTMLTableCellElement>(":scope > thead > tr:first-child > th"));
        if (!headers.length || headers.some(header => header.colSpan !== 1)) continue;
        if (!table.dataset.columnLayout) table.dataset.columnLayout = "auto";
        const rows = Array.from(table.tBodies).flatMap((body) => Array.from(body.rows)).filter((row) => !row.hasAttribute("data-virtual-spacer"));
        const columns = headers.filter(header => getComputedStyle(header).display !== "none").map(header => {
          const label = header.textContent?.replace(/[↑↓]\s*\d+/g, "").trim();
          const key = columnWidthKey(header.dataset.columnKey ?? (label || (header.querySelector('input[type="checkbox"]') ? "select" : "actions")));
          const cells = rows.filter(row => row.cells.length === headers.length).map(row => row.cells[header.cellIndex]).filter(cell => cell.colSpan === 1);
          let width = Math.max(minimumColumnWidth(key), measure(header, true));
          for (const cell of cells) width = Math.max(width, measure(cell, false));
          measurements[key] = Math.max(measurements[key] ?? 0, Math.ceil(width));
          const checkboxOnly = cells.length > 0 && cells.every(cell => cell.querySelector('input[type="checkbox"]') && !cell.innerText.trim());
          return { key, header, cells, grow: checkboxOnly ? 0 : undefined };
        });
        tables.push({ table, columns });
      }
      globalColumnWidths.publish(measurements);
      const parents = new Set<Element>();
      for (const { table, columns } of tables) {
        // React owns list/sale geometry; this pass still measures their custom cells.
        if (table.dataset.columnLayout === "managed" || getComputedStyle(table).display !== "table") continue;
        const parent = table.parentElement!;
        parents.add(parent);
        if (!watched.has(parent)) { watched.add(parent); resizeObserver.observe(parent); }
        const parentStyle = getComputedStyle(parent);
        const available = Math.max(0, parent.clientWidth - parseFloat(parentStyle.paddingLeft) - parseFloat(parentStyle.paddingRight));
        const layout = createColumnLayout(columns.map(column => ({key: column.key, minimum: globalColumnWidths.get(column.key), grow: column.grow})), available);
        let group = table.querySelector<HTMLTableColElement>(":scope > colgroup");
        if (!group) { group = document.createElement("colgroup"); table.prepend(group); }
        const count = table.tHead!.rows[0].cells.length;
        while (group.children.length < count) group.append(document.createElement("col"));
        while (group.children.length > count) group.lastElementChild!.remove();
        columns.forEach(({header}, index) => {
          (group!.children[header.cellIndex] as HTMLElement).style.width = layout.widths[index];
          header.style.width = layout.widths[index];
          header.style.minWidth = `${globalColumnWidths.get(columns[index].key)}px`;
        });
        table.style.tableLayout = "fixed";
        table.style.width = `${layout.tableWidth}px`;
        table.style.minWidth = `${layout.minimumWidth}px`;
      }
      for (const parent of watched) if (!parents.has(parent)) { resizeObserver.unobserve(parent); watched.delete(parent); }
    }
    const schedule = () => { if (active && !scheduled) scheduled = requestAnimationFrame(sizeTables); };
    const resizeObserver = new ResizeObserver(schedule);
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["class", "hidden"] });
    const unsubscribe = globalColumnWidths.subscribe(schedule);
    const onStorage = (event: StorageEvent) => {
      if (event.key !== globalColumnWidths.storageKey || !event.newValue) return;
      try { globalColumnWidths.publish(JSON.parse(event.newValue)); } catch { /* Ignore damaged browser preferences. */ }
    };
    document.addEventListener("input", schedule, true);
    document.addEventListener("change", schedule, true);
    window.addEventListener("resize", schedule);
    window.addEventListener("storage", onStorage);
    document.fonts.ready.then(schedule);
    document.fonts.addEventListener("loadingdone", schedule);
    schedule();
    return () => { active = false; observer.disconnect(); resizeObserver.disconnect(); unsubscribe(); cancelAnimationFrame(scheduled); document.fonts.removeEventListener("loadingdone", schedule); document.removeEventListener("input", schedule, true); document.removeEventListener("change", schedule, true); window.removeEventListener("resize", schedule); window.removeEventListener("storage", onStorage); };
  }, []);
  return null;
}
