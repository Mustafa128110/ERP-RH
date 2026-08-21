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
async function rasterize(node: HTMLElement): Promise<HTMLCanvasElement> {
  const { default: html2canvas } = await import("html2canvas");
  return html2canvas(node, {
    // Twice the CSS size: these get read on a phone, pinched and zoomed.
    scale: 2,
    // Explicit white — a transparent PNG over a dark chat background renders
    // black text invisible.
    backgroundColor: "#ffffff",
    logging: false,
  });
}

// In the document and revoked on a later tick, both deliberately: a detached
// anchor doesn't reliably start a download in Chrome, and revoking on the line
// after click() cancels the download that was about to read it — which looks
// exactly like a button that does nothing.
function saveBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export async function downloadNodeAsPng(node: HTMLElement, fileName: string) {
  console.log('[downloadNodeAsPng] Starting PNG download:', fileName);
  const canvas = await rasterize(node);
  console.log('[downloadNodeAsPng] Canvas received, creating blob');
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("The browser could not turn this into an image.");
  console.log('[downloadNodeAsPng] Blob created, size:', blob.size);
  saveBlob(blob, fileName);
}

// The same picture, cut into A4 pages.
//
// One tall image on one long page would print as a single unreadable strip, so
// the canvas is sliced: each page takes the next band of pixels, drawn through a
// scratch canvas because jsPDF places whole images and cannot crop.
export async function downloadNodeAsPdf(node: HTMLElement, fileName: string) {
  const canvas = await rasterize(node);
  // jsPDF is the other heavy dependency (with html2canvas it makes up the
  // ~400KB print chunk) — loaded on the click that asks for a file, same as
  // html2canvas above.
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const margin = 10;
  const pageWidth = doc.internal.pageSize.getWidth() - margin * 2;
  const pageHeight = doc.internal.pageSize.getHeight() - margin * 2;

  // How many source pixels fit on one page, at the scale that makes the image
  // span the printable width.
  const pixelsPerPage = Math.floor((canvas.width * pageHeight) / pageWidth);
  const slice = document.createElement("canvas");
  const context = slice.getContext("2d");
  if (!context) throw new Error("The browser could not prepare the page.");

  for (let top = 0, page = 0; top < canvas.height; top += pixelsPerPage, page++) {
    const height = Math.min(pixelsPerPage, canvas.height - top);
    slice.width = canvas.width;
    slice.height = height;
    // White first: the last page's band is shorter than a full page, and an
    // uncleared scratch canvas would carry the previous page's pixels into it.
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, slice.width, slice.height);
    context.drawImage(canvas, 0, top, canvas.width, height, 0, 0, canvas.width, height);

    if (page > 0) doc.addPage();
    doc.addImage(slice.toDataURL("image/png"), "PNG", margin, margin, pageWidth, (height * pageWidth) / canvas.width);
  }

  doc.save(fileName);
}
