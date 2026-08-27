import assert from "node:assert/strict";
import { BACKUP_WORKFLOWS, backupWorkflowDispatchUrl, isBackupWorkflowKind } from "./backup-dispatch";

assert.deepEqual(Object.keys(BACKUP_WORKFLOWS), ["backup", "restore"]);
assert.equal(isBackupWorkflowKind("backup"), true);
assert.equal(isBackupWorkflowKind("restore"), true);
assert.equal(isBackupWorkflowKind("anything-else"), false);
assert.equal(
  backupWorkflowDispatchUrl("backup", "Mustafa128110/ERP-RH"),
  "https://api.github.com/repos/Mustafa128110/ERP-RH/actions/workflows/database-backup.yml/dispatches",
);
assert.equal(
  backupWorkflowDispatchUrl("restore", "Mustafa128110/ERP-RH"),
  "https://api.github.com/repos/Mustafa128110/ERP-RH/actions/workflows/database-restore-verification.yml/dispatches",
);
assert.equal(backupWorkflowDispatchUrl("backup", "invalid"), null);

console.log("backup workflow dispatch checks passed");
