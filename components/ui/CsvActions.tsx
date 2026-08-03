"use client";

import { useRef, useState } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { secondaryActionClass } from "@/components/ui/form-styles";
import { csvToObjects, objectsToCsv, templateCsv, type CsvColumn } from "@/lib/csv";

// The Import / Export / Template trio that sits in a list page's header. The
// column list is the whole of the difference between one page's and another's
// (lib/csv-columns.ts), so both pages get the same three buttons rather than
// their own pair of hand-rolled ones.
//
// Parsing runs in the browser and the server action takes the parsed rows —
// lib/csv.ts runs on both sides, so a file never has to be uploaded, and a
// malformed one is refused without a round trip.

// Excel reads a CSV with no BOM as ANSI and mangles anything non-Latin, which
// here means every Urdu name. The parser strips it back off on the way in.
function download(text: string, filename: string) {
  const url = URL.createObjectURL(new Blob(["\uFEFF" + text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

const stamp = () => new Date().toLocaleDateString("en-CA");

export function CsvActions({
  columns,
  name,
  onImport,
  onExport,
  onDone,
}: {
  columns: CsvColumn[];
  // Used for the file names: `${name}-template.csv`, `${name}-2026-07-30.csv`.
  name: string;
  onImport: (rows: Record<string, string>[]) => Promise<{ error?: string; created?: number }>;
  onExport: () => Promise<Record<string, string>[]>;
  // Called after a successful import, so the list behind refreshes.
  onDone?: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ title: string; body: string } | null>(null);

  async function pick(file: File) {
    setBusy(true);
    try {
      const { rows, error } = csvToObjects(await file.text(), columns);
      if (error) return setMessage({ title: "Import failed", body: error });
      const result = await onImport(rows);
      if (result.error) return setMessage({ title: "Import failed", body: result.error });
      setMessage({ title: "Imported", body: `${result.created ?? 0} row(s) imported. Nothing else in the file was changed.` });
      onDone?.();
    } catch {
      setMessage({ title: "Import failed", body: "That file couldn't be read. Save it as CSV and try again." });
    } finally {
      setBusy(false);
    }
  }

  async function exportCsv() {
    setBusy(true);
    try {
      download(objectsToCsv(columns, await onExport()), `${name}-${stamp()}.csv`);
    } catch {
      setMessage({ title: "Export failed", body: "Couldn't read the rows to export. Try again." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <input
        ref={fileRef}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          // Cleared so picking the same file twice still fires a change event —
          // which is exactly what happens after fixing the file and re-importing.
          e.target.value = "";
          if (file) void pick(file);
        }}
      />
      <button type="button" onClick={() => download(templateCsv(columns), `${name}-template.csv`)} className={secondaryActionClass}>
        Template
      </button>
      <button type="button" onClick={() => void exportCsv()} disabled={busy} className={secondaryActionClass}>
        Export CSV
      </button>
      <button type="button" onClick={() => fileRef.current?.click()} disabled={busy} className={secondaryActionClass}>
        {busy ? "Working…" : "Import CSV"}
      </button>

      {message && (
        <Dialog title={message.title} onClose={() => setMessage(null)}>
          {/* Row-by-row problems arrive as one string of lines. */}
          <p className="whitespace-pre-line text-sm text-ink">{message.body}</p>
        </Dialog>
      )}
    </>
  );
}
