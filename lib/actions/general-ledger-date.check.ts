import assert from "node:assert/strict";
import { assertGeneralLedgerDateStaysPostCutover } from "./general-ledger";

function fakeTransaction(results: unknown[][]) {
  const queued = [...results];
  return {
    select: () => {
      const query = {
        from: () => query,
        where: () => query,
        limit: () => Promise.resolve(queued.shift() ?? []),
      };
      return query;
    },
  };
}

async function main() {
  await assert.doesNotReject(() => assertGeneralLedgerDateStaysPostCutover(
    fakeTransaction([[]]) as never,
    { companyId: "company", documentId: "document", documentDate: "2026-08-01" },
  ));

  await assert.doesNotReject(() => assertGeneralLedgerDateStaysPostCutover(
    fakeTransaction([[{ id: "entry" }], [{ value: "2026-08-01" }]]) as never,
    { companyId: "company", documentId: "document", documentDate: "2026-08-01" },
  ));

  await assert.rejects(
    () => assertGeneralLedgerDateStaysPostCutover(
      fakeTransaction([[{ id: "entry" }], [{ value: "2026-08-01" }]]) as never,
      { companyId: "company", expenseId: "expense", documentDate: "2026-07-31" },
    ),
    /cannot be dated before the GL cutover date/,
  );
  console.log("general-ledger date lock checks passed");
}

void main();
