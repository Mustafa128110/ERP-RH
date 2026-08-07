"use client";

import { useEffect, useRef, useState } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { Icon } from "@/components/ui/Icon";
import { iconButtonClass } from "@/components/ui/form-styles";
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
  // Collapsed by default. Three CSV buttons sat permanently across the top of
  // every list for the sake of an operation most people run once a month.
  const [open, setOpen] = useState(false);
  const groupRef = useRef<HTMLDivElement>(null);

  // Closing on an outside click (and on Escape) rather than on blur: the group
  // contains three focusable buttons, so a blur handler would close it while
  // tabbing between its own children.
  useEffect(() => {
    if (!open) return;
    function onPointer(e: PointerEvent) {
      if (!groupRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

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
      {/* One button that becomes three. The expanded trio sits inline rather
          than in a floating menu so it pushes the other header buttons along
          instead of covering them — on a phone the header wraps, and a dropdown
          would open over the first row of the list. */}
      <div ref={groupRef} className="flex items-center gap-2">
        {open && (
          <div className="reveal-right flex items-center gap-2">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={busy}
              className={iconButtonClass}
              aria-label="Import a CSV file"
              title={busy ? "Working…" : "Import CSV"}
            >
              <Icon name="import" />
            </button>
            <button
              type="button"
              onClick={() => void exportCsv()}
              disabled={busy}
              className={iconButtonClass}
              aria-label="Export these rows as CSV"
              title="Export CSV"
            >
              <Icon name="export" />
            </button>
            <button
              type="button"
              onClick={() => download(templateCsv(columns), `${name}-template.csv`)}
              className={iconButtonClass}
              aria-label="Download a blank CSV template"
              title="Blank template"
            >
              <Icon name="template" />
            </button>
          </div>
        )}
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className={iconButtonClass}
          aria-expanded={open}
          aria-label={open ? "Hide CSV actions" : "Show CSV actions"}
          title="Import, export, template"
        >
          <Icon name={open ? "close" : "more"} />
        </button>
      </div>

      {message && (
        <Dialog title={message.title} onClose={() => setMessage(null)}>
          {/* Row-by-row problems arrive as one string of lines. */}
          <p className="whitespace-pre-line text-sm text-ink">{message.body}</p>
        </Dialog>
      )}
    </>
  );
}
