"use client";

import { createContext, useContext, useMemo, useState } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { errorTextClass, secondaryActionClass, submitClass } from "@/components/ui/form-styles";
import { downloadExportFile, type ExportFile } from "@/lib/node-download";

type ExportShareContextValue = { presentExport: (file: ExportFile) => void };
const ExportShareContext = createContext<ExportShareContextValue | null>(null);

export function useExportShare() {
  const value = useContext(ExportShareContext);
  if (!value) throw new Error("useExportShare must be used within ExportShareProvider.");
  return value;
}

function fileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function ExportShareProvider({ children }: { children: React.ReactNode }) {
  const [file, setFile] = useState<ExportFile | null>(null);
  const [sharing, setSharing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const value = useMemo(() => ({ presentExport: (next: ExportFile) => { setError(null); setFile(next); } }), []);
  const nativeFile = file ? new File([file.blob], file.filename, { type: file.mimeType || file.blob.type }) : null;
  const shareAvailable = !!(nativeFile && typeof navigator !== "undefined" && "share" in navigator && "canShare" in navigator && navigator.canShare({ files: [nativeFile] }));

  async function share() {
    if (!file || sharing) return;
    if (!nativeFile || !shareAvailable) return;
    const data = { files: [nativeFile], title: file.filename };
    setSharing(true);
    setError(null);
    try {
      await navigator.share(data);
    } catch (cause) {
      // Closing the operating system share sheet is a normal decision, not a failure.
      if (!(cause instanceof DOMException && cause.name === "AbortError")) setError("Couldn't open the device share sheet. The downloaded file is still ready to use.");
    } finally {
      setSharing(false);
    }
  }

  return (
    <ExportShareContext.Provider value={value}>
      {children}
      {file && (
        <Dialog
          title="File ready to share"
          onClose={() => !sharing && setFile(null)}
          footer={
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button type="button" onClick={() => setFile(null)} disabled={sharing} className={secondaryActionClass}>Done</button>
              <button type="button" onClick={() => downloadExportFile(file)} className={secondaryActionClass}>Download again</button>
              {shareAvailable && <button type="button" onClick={() => void share()} disabled={sharing} className={submitClass}>{sharing ? "Opening share…" : "Share file"}</button>}
            </div>
          }
        >
          <div className="flex flex-col gap-3">
            <p role="status" aria-live="polite" className="rounded border border-success/30 bg-success-tint px-3 py-2 text-sm text-success">
              {file.mimeType === "application/pdf" ? "PDF downloaded." : "Image downloaded."}{shareAvailable ? " Choose Share file to send it through an app on this device." : " The file is ready on this device."}
            </p>
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm">
              <dt className="text-steel">File</dt>
              <dd className="safe-wrap min-w-0 text-right font-medium text-ink">{file.filename}</dd>
              <dt className="text-steel">Size</dt>
              <dd className="text-right tabular-nums text-ink">{fileSize(file.blob.size)}</dd>
            </dl>
            {!shareAvailable && <p role="status" className="text-sm text-steel">File sharing is not available in this browser. Use Download again if you need another copy.</p>}
            {error && <p role="alert" className={errorTextClass}>{error}</p>}
          </div>
        </Dialog>
      )}
    </ExportShareContext.Provider>
  );
}
