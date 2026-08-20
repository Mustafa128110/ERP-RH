import assert from "node:assert/strict";
import crypto from "node:crypto";
import { db } from "@/lib/db";
import { adjustSettlementBalancesBatch, SettlementScopeError } from "./settlement";

async function main() {
  // A random bank and company cannot be a valid pair. This safely executes the
  // full validating CTE (including both grouped UPDATE branches) without
  // changing application data, and proves a cross-company/missing target aborts
  // the transaction rather than silently posting.
  await assert.rejects(
    db.transaction((tx) =>
      adjustSettlementBalancesBatch(tx, [
        {
          direction: "out",
          amount: "1.00",
          bankAccountId: crypto.randomUUID(),
          cashAccountId: null,
          chequeId: null,
          sign: 1,
          companyId: crypto.randomUUID(),
        },
      ]),
    ),
    SettlementScopeError,
  );
  console.log("settlement batch SQL and ownership guard passed");
  process.exit(0);
}

void main();
