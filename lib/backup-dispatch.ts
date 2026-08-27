// The Settings page can ask GitHub Actions to run the same checked-in workflows
// that run on schedule.  Keeping the identifiers here, outside the Server
// Action module, makes the client input a closed set rather than an arbitrary
// workflow path supplied by the browser.

export const BACKUP_WORKFLOWS = {
  backup: {
    file: "database-backup.yml",
    auditSummary: "Manual encrypted backup requested",
  },
  restore: {
    file: "database-restore-verification.yml",
    auditSummary: "Manual restore verification requested",
  },
} as const;

export type BackupWorkflowKind = keyof typeof BACKUP_WORKFLOWS;

export function isBackupWorkflowKind(value: string): value is BackupWorkflowKind {
  return value === "backup" || value === "restore";
}

// The repository is intentionally a server-only environment setting at run
// time.  The checked-in fallback keeps local development and the current
// production repository simple, while a fork can point its own deployed app at
// its own Actions workflows without a code change.
export function backupWorkflowDispatchUrl(kind: BackupWorkflowKind, repository = process.env.GITHUB_BACKUP_REPOSITORY?.trim() || "Mustafa128110/ERP-RH") {
  const [owner, name] = repository.split("/");
  if (!owner || !name || repository.split("/").length !== 2) return null;
  return `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/actions/workflows/${BACKUP_WORKFLOWS[kind].file}/dispatches`;
}
