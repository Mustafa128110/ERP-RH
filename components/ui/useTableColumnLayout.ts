"use client";

import {useEffect, useState, type RefObject} from "react";
import {columnGrowWeight, createColumnLayout, fixedColumnMinimum} from "@/lib/column-widths";
import type {ColumnDef, Row} from "@/lib/table";

export function useTableColumnLayout(columns: ColumnDef[], rows: Row[], container: RefObject<HTMLElement | null>, selectable = false) {
  const [viewport, setViewport] = useState({width: 0, scale: 1});
  const hasRows = rows.length > 0;
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const measure = () => {
      const style = getComputedStyle(element);
      const width = Math.max(0, element.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight));
      const scale = parseFloat(getComputedStyle(document.documentElement).fontSize) / 16;
      setViewport(previous => previous.width === width && previous.scale === scale ? previous : {width, scale});
    };
    const observer = new ResizeObserver(measure);
    const zoom = new MutationObserver(measure);
    observer.observe(element);
    zoom.observe(document.documentElement, {attributes: true, attributeFilter: ["style", "class"]});
    measure();
    return () => {observer.disconnect(); zoom.disconnect();};
  }, [container, hasRows]);
  const layoutColumns = [
    ...(selectable ? [{key: "__select", minimum: 48 * viewport.scale, grow: 0}] : []),
    ...columns.map(column => ({key: column.key, minimum: fixedColumnMinimum(column) * viewport.scale,
      grow: column.align === "right" ? 0 : columnGrowWeight(column.key)})),
  ];
  const layout = createColumnLayout(layoutColumns, viewport.width);
  const widths = new Map(layoutColumns.map((column, index) => [column.key, layout.widths[index]]));
  return {minimumWidth: layout.minimumWidth, tableWidth: layout.tableWidth,
    selectionWidth: widths.get("__select"), getWidth: (column: ColumnDef) => widths.get(column.key) ?? "0px"};
}
