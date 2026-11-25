"use client";

import { useEffect } from "react";
import { columnContentKind, columnGrowWeight, columnWidthKey, createColumnLayout, fixedColumnMinimum } from "@/lib/column-widths";

// Applies proportional semantic widths only to plain tables that opt in (or have
// no explicit colgroup / width classes of their own). Tables with authored
// colgroups, Tailwind table-fixed/table-auto layouts, or .force-light documents
// keep their own proportions untouched.
export function ColumnSizing() {
  useEffect(() => {
    let frame = 0;
    let active = true;
    const watched = new Set<Element>();
    const resize = new ResizeObserver(schedule);

    function hasAuthoredSizing(table: HTMLTableElement): boolean {
      if (table.dataset.columnLayout === "managed") return true;
      if (table.dataset.columnLayout === "auto") return false;
      if (table.querySelector(":scope > colgroup")) return true;
      if (table.classList.contains("table-fixed") || table.classList.contains("table-auto")) return true;
      const headers = table.querySelectorAll<HTMLTableCellElement>(":scope > thead > tr:first-child > th");
      for (const header of headers) {
        if (/\b(?:w-|min-w-|max-w-)/.test(header.className)) return true;
      }
      return false;
    }

    function sizeTables() {
      frame = 0;
      const parents = new Set<Element>();
      const scale = parseFloat(getComputedStyle(document.documentElement).fontSize) / 16;

      for (const table of document.querySelectorAll("table")) {
        if (table.closest('[aria-hidden="true"],.force-light') || hasAuthoredSizing(table)) continue;
        const headers = Array.from(table.querySelectorAll<HTMLTableCellElement>(":scope > thead > tr:first-child > th"));
        if (!headers.length || headers.some((header) => header.colSpan !== 1)) continue;
        const parent = table.parentElement!;
        parents.add(parent);
        if (!watched.has(parent)) {
          watched.add(parent);
          resize.observe(parent);
        }

        table.dataset.columnLayout = "auto";
        const columns = headers.map((header) => {
          const label = header.textContent?.replace(/[↑↓]\s*\d+/g, "").trim();
          const key = columnWidthKey(
            header.dataset.columnKey ?? (label || (header.querySelector('input[type="checkbox"]') ? "select" : "actions")),
          );
          const align = getComputedStyle(header).textAlign === "right" ? "right" : "left";
          const kind = columnContentKind(key, align);
          header.dataset.columnKey = key;
          header.dataset.cellKind = kind;
          let dateEditor = false;
          for (const body of table.tBodies) {
            for (const row of body.rows) {
              if (row.cells.length === headers.length && !row.hasAttribute("data-virtual-spacer")) {
                const cell = row.cells[header.cellIndex];
                cell.dataset.cellKind = kind;
                if (kind === "date" && cell.querySelector('[data-date-field],input[type="date"]')) dateEditor = true;
              }
            }
          }
          return {
            key,
            minimum: (fixedColumnMinimum({ key, align }) + (dateEditor ? 36 : 0)) * scale,
            grow: align === "right" ? 0 : columnGrowWeight(key),
          };
        });

        const style = getComputedStyle(parent);
        const available = parent.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
        const layout = createColumnLayout(columns, available);
        let group = table.querySelector<HTMLTableColElement>(":scope > colgroup");
        if (!group) {
          group = document.createElement("colgroup");
          table.prepend(group);
        }
        while (group.children.length < headers.length) group.append(document.createElement("col"));
        while (group.children.length > headers.length) group.lastElementChild!.remove();

        headers.forEach((header, index) => {
          (group!.children[index] as HTMLElement).style.width = layout.widths[index];
          header.style.width = layout.widths[index];
          header.style.minWidth = "";
        });

        table.style.tableLayout = "fixed";
        table.style.width = `${layout.tableWidth}px`;
        table.style.minWidth = `${layout.minimumWidth}px`;
      }

      for (const parent of watched) {
        if (!parents.has(parent)) {
          resize.unobserve(parent);
          watched.delete(parent);
        }
      }
    }

    function schedule() {
      if (active && !frame) frame = requestAnimationFrame(sizeTables);
    }

    const mutations = new MutationObserver(schedule);
    mutations.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "hidden"],
    });
    const zoom = new MutationObserver(schedule);
    zoom.observe(document.documentElement, { attributes: true, attributeFilter: ["style"] });
    window.addEventListener("resize", schedule);
    schedule();

    return () => {
      active = false;
      cancelAnimationFrame(frame);
      resize.disconnect();
      mutations.disconnect();
      zoom.disconnect();
      window.removeEventListener("resize", schedule);
    };
  }, []);

  return null;
}
