"use client";

import { useState } from "react";
import { exportSnapshot } from "@/lib/actions/backups";
import type { SnapshotTable } from "@/lib/backup-constants";
import { secondaryActionClass } from "@/components/ui/form-styles";

// Excel reads a CSV with no BOM as ANSI and mangles anything non-Latin — which
// here means every Urdu product name. Same reason CsvActions writes one.
function download(text: string, filename: string) {
  const url = URL.createObjectURL(new Blob(["﻿" + text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function toCsv(rows: Record<string, string>[]): string {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  const cell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return [headers.map(cell).join(","), ...rows.map((r) => headers.map((h) => cell(r[h] ?? "")).join(","))].join("\n");
}

const stamp = () => new Date().toLocaleDateString("en-CA");

export function SnapshotExport({ tables, sizes }: { tables: SnapshotTable[]; sizes: Record<string, number> }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function run(key: string, label: string) {
    setBusy(key);
    setMessage(null);
    try {
      const result = await exportSnapshot(key);
      if (result.error) return setMessage(result.error);
      if (!result.rows || result.rows.length === 0) return setMessage(`${label}: nothing to export yet.`);
      download(toCsv(result.rows), `${key}-${stamp()}.csv`);
    } catch {
      setMessage(`${label}: the export failed. Try again — nothing was changed.`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {message && <p className="rounded border border-sand bg-ivory p-3 text-sm text-ink">{message}</p>}
      <ul className="flex flex-col divide-y divide-sand">
        {tables.map((t) => (
          <li key={t.key} className="flex items-center justify-between gap-4 py-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-ink">
                {t.label}
                {sizes[t.key] !== undefined && <span className="ml-2 text-xs text-steel">{sizes[t.key]} row(s)</span>}
              </p>
              <p className="text-xs text-steel">{t.description}</p>
            </div>
            <button type="button" onClick={() => void run(t.key, t.label)} disabled={busy !== null} className={secondaryActionClass}>
              {busy === t.key ? "Building…" : "Download CSV"}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
