export const A4_CSS_WIDTH = 794;
export const A4_CSS_HEIGHT = 1123;
export const A4_PADDING = 24;

// Row boundaries are chosen before rasterisation, so a large ledger never
// becomes one enormous canvas and no line is sliced in half between pages.
export async function paginateExport(node: HTMLElement) {
  await document.fonts.ready;
  const host = document.createElement("div");
  host.className = "force-light";
  Object.assign(host.style, { position: "fixed", top: "0", left: "0", zIndex: "-1000", pointerEvents: "none", width: `${A4_CSS_WIDTH}px`, background: "white" });
  document.body.append(host);
  const source = node.cloneNode(true) as HTMLElement;
  Object.assign(source.style, { padding: "0", margin: "0", width: "100%", maxWidth: "none", height: "auto", overflow: "visible" });
  for (const table of source.querySelectorAll("table")) Object.assign(table.style, { width: "100%", tableLayout: "auto", marginLeft: "0", marginRight: "0" });
  for (const cell of source.querySelectorAll<HTMLElement>("th,td")) Object.assign(cell.style, { width: "auto", minWidth: "0", maxWidth: "none", whiteSpace: "normal", overflow: "visible", overflowWrap: "anywhere", paddingLeft: "4px", paddingRight: "4px" });
  const pages: HTMLElement[] = [];
  let content: HTMLElement;
  const limit = A4_CSS_HEIGHT - 2 * A4_PADDING - 20;
  const letterhead = source.firstElementChild;
  function newPage() {
    const page = document.createElement("div");
    page.className = "force-light bg-white text-ink";
    Object.assign(page.style, { position: "relative", width: `${A4_CSS_WIDTH}px`, minHeight: `${A4_CSS_HEIGHT}px`, padding: `${A4_PADDING}px`, boxSizing: "border-box", background: "#fff", fontSize: "13px" });
    content = document.createElement("div");
    content.style.width = "100%";
    page.append(content);
    host.append(page);
    if (pages.length && letterhead) content.append(letterhead.cloneNode(true));
    pages.push(page);
  }
  function fits() { return content.scrollHeight <= limit; }
  try {
    newPage();
    for (const child of Array.from(source.children)) {
      if (!(child instanceof HTMLTableElement)) {
        const copy = child.cloneNode(true) as HTMLElement;
        content!.append(copy);
        if (!fits()) { copy.remove(); newPage(); content!.append(copy); }
        if (!fits()) throw new Error("A statement section is too tall for an A4 page.");
        continue;
      }
      const sourceTable = child;
      let table: HTMLTableElement;
      let body: HTMLTableSectionElement;
      function newTable() {
        table = sourceTable.cloneNode(false) as HTMLTableElement;
        if (sourceTable.tHead) table.append(sourceTable.tHead.cloneNode(true));
        body = document.createElement("tbody");
        table.append(body);
        content.append(table);
      }
      newTable();
      for (const row of Array.from(child.tBodies).flatMap((section) => Array.from(section.rows))) {
        const copy = row.cloneNode(true) as HTMLTableRowElement;
        body!.append(copy);
        if (!fits()) {
          copy.remove();
          if (!body!.rows.length) table!.remove();
          newPage(); newTable(); body!.append(copy);
        }
        if (!fits()) throw new Error("A statement row is too tall for an A4 page.");
      }
      if (child.tFoot) {
        const foot = child.tFoot.cloneNode(true) as HTMLElement;
        table!.append(foot);
        if (!fits()) { foot.remove(); newPage(); newTable(); table!.append(foot); }
      }
    }
    pages.forEach((page, index) => {
      const footer = document.createElement("div");
      footer.textContent = `Page ${index + 1} of ${pages.length}`;
      Object.assign(footer.style, { position: "absolute", bottom: "10px", right: `${A4_PADDING}px`, fontSize: "10px", color: "#555" });
      page.append(footer);
    });
    return { pages, dispose: () => host.remove() };
  } catch (error) { host.remove(); throw error; }
}
