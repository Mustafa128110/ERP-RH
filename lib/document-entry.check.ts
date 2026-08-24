import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// Two rules about entering documents back to back, both of which were broken in
// ways that read as "saved" to the person at the keyboard while nothing was
// written. They are pinned here because neither shows up as a type error and
// neither has a database to test against — both are properties of the source.

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

// ---------------------------------------------------------------------------
// 1. The operation id is spent by a save that lands
// ---------------------------------------------------------------------------

// A form mints one operation id and sends it with every submit; the server claims
// it inside the same transaction as the document, so a replayed submit is refused
// rather than posted twice (lib/actions/operation-id.ts). The claim is kept for a
// day — which means a form that *stays open* to take the next document has to stop
// sending the id it just spent. It didn't, and every second sale entered from one
// open form was refused with "This save was already recorded" while writing
// nothing.
//
// The rule: a form that clears itself for another entry must mint a new id.
const REUSED_FORMS = [
  "components/modules/SaleForm.tsx",
  "components/modules/StockPurchaseForm.tsx",
  "components/modules/StockTransferForm.tsx",
  "components/modules/StockAdjustmentForm.tsx",
  "components/modules/InterCompanyForm.tsx",
] as const;

for (const file of REUSED_FORMS) {
  const source = read(file);
  assert.ok(
    source.includes("const [operationId, setOperationId] = useState(() => crypto.randomUUID())"),
    `${file} must hold its operation id in state it can replace`,
  );
  assert.ok(
    source.includes("setOperationId(crypto.randomUUID())"),
    `${file} resets itself for the next entry, so it must mint a new operation id — otherwise the next save is refused as a replay of the one before it`,
  );
}

// A form that only ever resets after a save has to re-mint; the converse is what
// keeps the guard honest, so no file may re-mint anywhere the outcome is unknown.
// After a lost response the save may well have landed, and holding the spent id is
// the only thing that stops the retry from posting the document twice.
//
// Enforced by requiring a `.success` test in the lines just above each re-mint —
// prose about success doesn't count, only a property read on the result.
const componentsDir = path.join(root, "components", "modules");
let remints = 0;
for (const name of fs.readdirSync(componentsDir)) {
  if (!name.endsWith(".tsx")) continue;
  const lines = read(path.posix.join("components/modules", name)).split(/\r?\n/);
  lines.forEach((line, index) => {
    if (!line.includes("setOperationId(crypto.randomUUID())")) return;
    remints += 1;
    const window = lines.slice(Math.max(0, index - 15), index);
    assert.ok(
      window.some((l) => l.includes(".success")),
      `components/modules/${name}:${index + 1} mints a new operation id without a confirmed success above it — a re-mint on an unknown outcome is what lets a lost response post twice`,
    );
  });
}
assert.ok(remints >= REUSED_FORMS.length, "expected every stay-open form to re-mint");

// The claim itself must stay inside the transaction it guards: that is what makes
// a rolled-back save leave no claim behind, so retrying a genuine failure works.
const operationId = read("lib/actions/operation-id.ts");
assert.ok(operationId.includes("claimOperation(tx: Tx"), "the claim must run on the transaction handle");
assert.ok(operationId.includes("ON CONFLICT (key) DO UPDATE"), "the stale-key arm must survive");

// ---------------------------------------------------------------------------
// 2. A missing unit conversion doesn't refuse a sale
// ---------------------------------------------------------------------------

// resolveBaseQuantities already assumes a multiplier of 1 in two of the three cases
// where it can't know one — the item has no base unit, or the line has no unit. The
// third case (a unit with no conversion to the base unit) threw, which turned a gap
// in the products page into a customer standing at a counter that won't take their
// money. The sale now goes through with the entered quantity counted as base units.
const conversion = read("lib/queries/unit-conversion.ts");
assert.ok(
  conversion.includes('onMissing: MissingConversionPolicy = "throw"'),
  "the strict policy must stay the default, so relaxing a document is a deliberate edit",
);
assert.ok(
  conversion.includes('onMissing === "throw" &&'),
  "the policy must be what gates the throw",
);
assert.ok(
  conversion.includes("if (rows.length !== lines.length) throw new MissingUnitConversionError();"),
  "a statement that didn't answer for every line is a fault, and no policy may guess past it",
);
assert.ok(
  conversion.includes("row.base_quantity === null ? Math.abs(lines[index].quantity)"),
  "the relaxed path must fall back to the entered quantity, matching what the statement was handed",
);

const sales = read("lib/actions/sales.ts");
assert.ok(sales.includes('"assume-base"'), "a sale must not be refused over a conversion nobody has entered yet");
assert.ok(
  sales.includes("e instanceof MissingUnitConversionError"),
  "the row-count fault must still reach the user as a sentence rather than an unmount",
);

console.log("document-entry.check: ok — spent operation ids are replaced only on a confirmed save, and a missing unit conversion no longer refuses a sale");
