// Turning something already on the page into a file people can send.
//
// The alternative is drawing every document twice — once for the screen and once
// for the generator — which the invoice already does and which has to be kept in
// step by hand. For everything after it, the page is the layout: photograph it,
// and a PDF is that photograph on paper.
//
// A rasterised PDF doesn't have selectable text, so it isn't the right answer for
// the invoice (lib/invoice-pdf.ts draws that one properly). It is the right
// answer for a balance sheet nobody copy-pastes out of.

// html2canvas is loaded on demand: ~200KB that only matters the moment someone
// asks for a file. It comes in as jsPDF's own optional dependency and is pinned
// in package.json so a jsPDF upgrade can't take it away.
import { paginateExport } from "@/lib/export-pages";

async function rasterize(node: HTMLElement): Promise<HTMLCanvasElement> {
  const { default: html2canvas } = await import("html2canvas");
  return html2canvas(node, {
    // Twice the CSS size: these get read on a phone, pinched and zoomed.
    scale: 2,
    // Explicit white — a transparent PNG over a dark chat background renders
    // black text invisible.
    backgroundColor: "#ffffff",
    logging: false,
    width: node.scrollWidth,
    height: node.scrollHeight,
    scrollX: 0,
    scrollY: 0,
  });
}

export type ExportFile = {
  blob: Blob;
  filename: string;
  mimeType: string;
  pages?: ExportFile[];
};

// In the document and revoked on a later tick, both deliberately: a detached
// anchor doesn't reliably start a download in Chrome, and revoking on the line
// after click() cancels the download that was about to read it — which looks
// exactly like a button that does nothing.
export function downloadExportFile(file: ExportFile) {
  if (file.pages) { for (const page of file.pages) downloadExportFile(page); return; }
  const { blob, filename } = file;
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export async function downloadNodeAsPng(node: HTMLElement, fileName: string): Promise<ExportFile> {
  const document = await paginateExport(node);
  try {
    const files: ExportFile[] = [];
    for (const [index, page] of document.pages.entries()) {
      const canvas = await rasterize(page);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
      if (!blob) throw new Error("The browser could not turn this into an image.");
      files.push({ blob, filename: document.pages.length === 1 ? fileName : fileName.replace(/\.png$/i, `-page-${String(index + 1).padStart(2, "0")}.png`), mimeType: "image/png" });
    }
    const result = files.length === 1 ? files[0] : { ...files[0], pages: files };
    downloadExportFile(result);
    return result;
  } finally { document.dispose(); }
}

// The same picture, cut into A4 pages.
//
// One tall image on one long page would print as a single unreadable strip, so
// the canvas is sliced: each page takes the next band of pixels, drawn through a
// scratch canvas because jsPDF places whole images and cannot crop.
export async function downloadNodeAsPdf(node: HTMLElement, fileName: string): Promise<ExportFile> {
  // jsPDF is the other heavy dependency (with html2canvas it makes up the
  // ~400KB print chunk) — loaded on the click that asks for a file, same as
  // html2canvas above.
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const document = await paginateExport(node);
  try {
    for (const [index, page] of document.pages.entries()) {
      const canvas = await rasterize(page);
      if (index) doc.addPage();
      doc.addImage(canvas.toDataURL("image/png"), "PNG", 0, 0, 210, 297);
    }
  } finally { document.dispose(); }

  const file = { blob: doc.output("blob"), filename: fileName, mimeType: "application/pdf" };
  downloadExportFile(file);
  return file;
}
