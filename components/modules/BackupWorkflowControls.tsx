"use client";

import { useState, useTransition } from "react";
import { dispatchBackupWorkflow } from "@/lib/actions/backups";
import { Dialog } from "@/components/ui/Dialog";
import { primaryActionClass, secondaryActionClass, errorTextClass, successTextClass } from "@/components/ui/form-styles";

export function BackupWorkflowControls({ canDispatch }: { canDispatch: boolean }) {
  const [pending, startTransition] = useTransition();
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [message, setMessage] = useState<{ kind: "error" | "success"; text: string } | null>(null);

  function start(kind: "backup" | "restore") {
    setMessage(null);
    startTransition(async () => {
      const result = await dispatchBackupWorkflow(kind);
      if (result.error) {
        setMessage({ kind: "error", text: result.error });
        return;
      }
      setRestoreOpen(false);
      setMessage({
        kind: "success",
        text: kind === "backup" ? "Backup workflow started. Check GitHub Actions for its progress." : "Restore verification started. It uses a disposable database and does not change production.",
      });
    });
  }

  return (
    <>
      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <button type="button" className={primaryActionClass} onClick={() => start("backup")} disabled={!canDispatch || pending}>
          {pending ? "Starting…" : "Run backup now"}
        </button>
        <button type="button" className={secondaryActionClass} onClick={() => setRestoreOpen(true)} disabled={!canDispatch || pending}>
          Restore backup
        </button>
      </div>
      {!canDispatch && <p className="mt-3 text-sm text-steel">Only a system administrator with global backup permission can run these workflows.</p>}
      {message && <p className={`mt-3 ${message.kind === "error" ? errorTextClass : successTextClass}`} role="status" aria-live="polite">{message.text}</p>}

      {restoreOpen && (
        <Dialog
          title="Restore backup"
          onClose={() => {
            if (!pending) setRestoreOpen(false);
          }}
          footer={
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button type="button" className={secondaryActionClass} onClick={() => setRestoreOpen(false)} disabled={pending}>Cancel</button>
              <button type="button" className={primaryActionClass} onClick={() => start("restore")} disabled={pending}>
                {pending ? "Starting…" : "Start restore verification"}
              </button>
            </div>
          }
        >
          <p className="text-sm text-ink">
            This starts the manual restore-verification workflow for the latest encrypted R2 archive.
          </p>
          <p className="mt-3 text-sm text-steel">
            It restores only into a disposable PostgreSQL database. Production data is never overwritten by this button.
          </p>
          {message?.kind === "error" && <p className={`mt-3 ${errorTextClass}`} role="alert">{message.text}</p>}
        </Dialog>
      )}
    </>
  );
}
