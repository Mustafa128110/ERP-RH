// Database-state verification for scripts/verify-flows.mjs.
//
// verify-flows.mjs drives the browser through every critical create, drops the
// response after a committed save and replays it. What the browser sees is only
// half the proof — the other half is the database holding exactly one logical
// transaction per flow, with every dependent record (lines, stock movements,
// ledger entries) created exactly once. This script reads the results file
// verify-flows.mjs writes (default /tmp/erp-verify.json) and checks that.
//
//   node --env-file=.env scripts/verify-db.mjs [path-to-verify-json]
//
// Also verifies the "retry after a never-reached request" and "double click"
// modes, where the same marker must still end up as exactly one transaction.
import os from "node:os";
import fs from "node:fs";
import postgres from "postgres";

const file = process.argv[2] ?? `${os.tmpdir()}/erp-verify.json`;
if (!fs.existsSync(file)) {
  console.error(`results file not found: ${file}`);
  process.exit(1);
}
const out = JSON.parse(fs.readFileSync(file, "utf8"));
const sql = postgres(process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL, { max: 3 });

let failures = 0;
const check = (label, cond, detail = "") => {
  console.log(`${cond ? "ok  " : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!cond) failures++;
};

const row = (rows) => rows[0];

// Every document that has a line on the given item — a flow replaying under a
// second operation id would surface here as a second document.
async function docsForItem(itemId) {
  return sql`
    select distinct d.id, d.number, d.status, d.grand_total, dt.code
    from documents d
    join document_lines dl on dl.document_id = d.id
    join document_types dt on dt.id = d.document_type_id
    where dl.item_id = ${itemId}
  `;
}

async function lineCount(docId) {
  return (await sql`select count(*)::int as n from document_lines where document_id = ${docId}`)[0].n;
}

async function movements(docId) {
  return sql`
    select it.movement, it.quantity from inventory_transactions it
    join document_lines dl on dl.id = it.document_line_id
    where dl.document_id = ${docId}
    order by it.created_at, it.id
  `;
}

async function ledgerFor(docId) {
  return sql`select debit, credit from ledger_entries where document_id = ${docId}`;
}

// A single item walked to exactly one document with the expected shape: N lines,
// the given movement set, the given ledger rows, no strays anywhere.
async function verifyItemFlow(marker, { itemName, expectLines, expectMoves, expectLedger, label }) {
  const item = row(await sql`select id, name from items where name = ${itemName}`);
  check(`${label}: item created exactly once`, !!item, itemName);
  if (!item) return;
  const dupeItems = await sql`select count(*)::int as n from items where name = ${itemName}`;
  check(`${label}: no duplicate item rows`, dupeItems[0].n === 1, `found ${dupeItems[0].n}`);

  const docs = await docsForItem(item.id);
  check(`${label}: exactly one document`, docs.length === 1, docs.map((d) => `${d.code} ${d.number} (${d.id.slice(0, 8)})`).join(", ") || "none");
  if (docs.length !== 1) return;
  const doc = docs[0];

  const lines = await lineCount(doc.id);
  check(`${label}: ${expectLines} document line(s)`, lines === expectLines, `found ${lines}`);

  const moves = await movements(doc.id);
  const moveShape = moves.map((m) => `${m.movement === 1 ? "+" : ""}${m.movement}×${Number(m.quantity)}`).join(", ");
  const expectedShape = [...expectMoves]
    .sort((a, b) => a.movement - b.movement || Number(a.quantity) - Number(b.quantity))
    .map((m) => `${m.movement === 1 ? "+" : ""}${m.movement}×${Number(m.quantity)}`)
    .join(", ");
  const actualShape = moves
    .sort((a, b) => a.movement - b.movement || Number(a.quantity) - Number(b.quantity))
    .map((m) => `${m.movement === 1 ? "+" : ""}${m.movement}×${Number(m.quantity)}`)
    .join(", ");
  check(`${label}: inventory movements are ${expectedShape}`, moves.length === expectMoves.length && actualShape === expectedShape, moveShape || "none");

  const ledger = await ledgerFor(doc.id);
  const ledgerShape = ledger.map((l) => `${Number(l.debit) > 0 ? `debit ${l.debit}` : `credit ${l.credit}`}`).join(", ");
  check(
    `${label}: ledger rows match ${JSON.stringify(expectLedger)}`,
    ledger.length === expectLedger.length &&
      expectLedger.every((want) => ledger.some((l) => Number(l.debit) === want.debit && Number(l.credit) === want.credit)),
    ledgerShape || "none",
  );

  const numberLedger = await sql`select count(*)::int as n from document_number_ledger where document_id = ${doc.id}`;
  check(`${label}: document number logged once`, numberLedger[0].n === 1, `found ${numberLedger[0].n}`);

  const audit = await sql`select count(*)::int as n from audit_logs where entity_id = ${doc.id}`;
  check(`${label}: audit entry recorded`, audit[0].n === 1, `found ${audit[0].n}`);
  return doc;
}

// A single item mirrored to another company (inter-company sales copy the SKU)
// walks to both documents, one per company — matching by SKU rather than by
// item id, because the buyer's row is a different physical row.
async function docsForSku(sku) {
  return sql`
    select distinct d.id, d.number, d.status, d.grand_total, dt.code
    from documents d
    join document_lines dl on dl.document_id = d.id
    join items i on i.id = dl.item_id
    join document_types dt on dt.id = d.document_type_id
    where i.sku = ${sku}
  `;
}

// --- one flow per critical create ------------------------------------------
async function verifySale(marker) {
  const doc = await verifyItemFlow(marker, {
    itemName: `TI-sale-${marker}`,
    expectLines: 1,
    expectMoves: [{ movement: -1, quantity: 2 }],
    // The sale form settles from the drawer by default, so the 21 is paid in
    // cash and nothing lands on the customer's ledger.
    expectLedger: [],
    label: "sale",
  });
  if (doc) {
    check("sale: document is a posted sales invoice", doc.code === "SALES_INVOICE" && doc.status === "posted", `${doc.code}/${doc.status}`);
    const paid = row(await sql`select is_paid, paid_amount, grand_total from documents where id = ${doc.id}`);
    check("sale: settled in full at the counter", paid?.is_paid === true && Number(paid.paid_amount) === Number(paid.grand_total), `paid ${paid?.paid_amount}/${paid?.grand_total}`);
  }
}

async function verifyPurchase(marker) {
  const supplier = row(await sql`select id from contacts where display_name = ${`SP-${marker}`}`);
  check("purchase: supplier created exactly once", !!supplier);
  if (supplier) {
    const dupes = await sql`select count(*)::int as n from contacts where display_name = ${`SP-${marker}`}`;
    check("purchase: no duplicate supplier rows", dupes[0].n === 1);
  }
  const doc = await verifyItemFlow(marker, {
    itemName: `TI-purchase-${marker}`,
    expectLines: 1,
    expectMoves: [{ movement: 1, quantity: 1 }],
    expectLedger: [{ debit: 0, credit: 50 }], // 1 × 50, unpaid → payable
    label: "purchase",
  });
  if (doc && supplier) {
    const linked = row(await sql`select contact_id from documents where id = ${doc.id}`);
    check("purchase: document points at the supplier", linked?.contact_id === supplier.id);
  }
}

async function verifyPayment(marker) {
  const contact = row(await sql`select id from contacts where display_name = ${`TP-${marker}`}`);
  check("payment: contact created exactly once", !!contact);
  if (!contact) return;
  const dupes = await sql`select count(*)::int as n from contacts where display_name = ${`TP-${marker}`}`;
  check("payment: no duplicate contact rows", dupes[0].n === 1);

  const docs = await sql`
    select d.id, d.number, dt.code from documents d
    join document_types dt on dt.id = d.document_type_id
    where d.contact_id = ${contact.id}
  `;
  check("payment: exactly one payment document", docs.length === 1, docs.map((d) => `${d.code} ${d.number}`).join(", ") || "none");
  if (docs.length !== 1) return;
  const doc = docs[0];
  check("payment: document is a payment", doc.code === "PAYMENT_MADE" || doc.code === "PAYMENT_RECEIVED", doc.code);

  const ledger = await ledgerFor(doc.id);
  check("payment: one ledger row of 33", ledger.length === 1 && (Number(ledger[0].debit) === 33 || Number(ledger[0].credit) === 33), JSON.stringify(ledger));
  // The batch action audits once per batch without an entity id: "1 payment(s)
  // entered in batch", Total 33.
  const audit = await sql`select count(*)::int as n from audit_logs where entity = 'payment' and detail like 'Total 33%' and created_at >= current_date`;
  check("payment: audit entry recorded", audit[0].n >= 1, `found ${audit[0].n}`);
}

async function verifyCashTransfer() {
  // No marker lands in the DB — the two documents are found by their shared
  // random key, so the before/after counts from the flow run are the anchor.
  const before = out.transferOutBefore ?? 0;
  // The database's current_date runs in the server's timezone and can lag the
  // app's local day, so filter on the app's own today (out.today).
  const outCount = (await sql`select count(*)::int as n from documents where reason like 'Cash Transfer out %' and document_date = ${out.today}`)[0].n;
  const inCount = (await sql`select count(*)::int as n from documents where reason like 'Cash Transfer in %' and document_date = ${out.today}`)[0].n;
  check("cash transfer: exactly one 'out' document added", outCount === before + 1, `${before} → ${outCount}`);
  check("cash transfer: exactly one 'in' document added", inCount === (out.transferInBefore ?? 0) + 1, `${out.transferInBefore ?? 0} → ${inCount}`);

  // And the two halves must share the transfer key (one logical transfer).
  // Earlier test runs leave their own pairs behind, so anchor on this run's
  // pair: the newest 'out' document's key must have exactly one matching 'in'.
  const outDocs = await sql`select id, reason from documents where reason like 'Cash Transfer out %' and document_date = ${out.today} order by created_at desc`;
  const inDocs = await sql`select id, reason from documents where reason like 'Cash Transfer in %' and document_date = ${out.today} order by created_at desc`;
  const newestOut = outDocs[0];
  check("cash transfer: this run's out document exists", !!newestOut);
  if (newestOut) {
    const key = newestOut.reason.split(" ")[3];
    const outOfPair = outDocs.filter((d) => d.reason.split(" ")[3] === key);
    const inOfPair = inDocs.filter((d) => d.reason.split(" ")[3] === key);
    check("cash transfer: exactly one document per half of the pair", outOfPair.length === 1 && inOfPair.length === 1, `out ${outOfPair.length}, in ${inOfPair.length}`);
  }
}

async function verifyStockTransfer(marker) {
  const doc = await verifyItemFlow(marker, {
    itemName: `TI-transfer-${marker}`,
    expectLines: 2, // one line per pair — source and destination
    expectMoves: [
      { movement: -1, quantity: 3 },
      { movement: 1, quantity: 3 },
    ],
    expectLedger: [],
    label: "stock transfer",
  });
  if (doc) check("stock transfer: document is a posted transfer", doc.code === "STOCK_TRANSFER" && doc.status === "posted", `${doc.code}/${doc.status}`);
}

async function verifyAdjustment(marker) {
  const doc = await verifyItemFlow(marker, {
    itemName: `TI-adjust-${marker}`,
    expectLines: 1,
    expectMoves: [{ movement: -1, quantity: 1 }],
    expectLedger: [],
    label: "stock adjustment",
  });
  if (doc) check("stock adjustment: document is a posted adjustment", doc.code === "STOCK_ADJUSTMENT" && doc.status === "posted", `${doc.code}/${doc.status}`);
}

async function verifyInterCompany(marker) {
  const item = row(await sql`select id, sku from items where name = ${`TI-ic-${marker}`}`);
  check("inter-company: item created exactly once", !!item);
  if (!item) return;
  // The buyer's row is a mirror of the seller's (same SKU, its own company), so
  // both documents are found by SKU, not by item id.
  const docs = await docsForSku(item.sku);
  check("inter-company: exactly two documents (sale + purchase)", docs.length === 2, docs.map((d) => `${d.code} ${d.number}`).join(", ") || "none");
  if (docs.length !== 2) return;
  const codes = docs.map((d) => d.code).sort();
  check("inter-company: one sales invoice, one purchase invoice", codes[0] === "PURCHASE_INVOICE" && codes[1] === "SALES_INVOICE", codes.join(", "));
  for (const d of docs) {
    const lines = await lineCount(d.id);
    check(`inter-company: ${d.code} has 1 line`, lines === 1, `found ${lines}`);
  }
  const moves = (await Promise.all(docs.map((d) => movements(d.id)))).flat();
  const shape = moves
    .sort((a, b) => a.movement - b.movement)
    .map((m) => `${m.movement === 1 ? "+" : ""}${m.movement}×${Number(m.quantity)}`)
    .join(", ");
  check("inter-company: one -1 and one +1 movement of 1", moves.length === 2 && shape === "-1×1, +1×1", shape || "none");
  const ledgers = (await Promise.all(docs.map((d) => ledgerFor(d.id)))).flat();
  const ledgerShape = ledgers.map((l) => `${Number(l.debit) > 0 ? `debit ${Number(l.debit)}` : `credit ${Number(l.credit)}`}`).sort().join(", ");
  check("inter-company: receivable debit and payable credit of 10", ledgers.length === 2 && ledgerShape === "credit 10, debit 10", ledgerShape || "none");
}

async function verifyQuotation(marker) {
  const contact = row(await sql`select id from contacts where display_name = ${`TQ-${marker}`}`);
  check("quotation: customer created exactly once", !!contact);
  if (contact) {
    const dupes = await sql`select count(*)::int as n from contacts where display_name = ${`TQ-${marker}`}`;
    check("quotation: no duplicate customer rows", dupes[0].n === 1);
  }
  const doc = await verifyItemFlow(marker, {
    itemName: `TI-quote-${marker}`,
    expectLines: 1,
    expectMoves: [], // a quotation moves nothing
    expectLedger: [], // and books nothing
    label: "quotation",
  });
  if (doc && contact) {
    check("quotation: document is a pending quotation", doc.code === "QUOTATION" && doc.status === "pending", `${doc.code}/${doc.status}`);
    const linked = row(await sql`select contact_id from documents where id = ${doc.id}`);
    check("quotation: document points at the customer", linked?.contact_id === contact.id);
  }
}

async function verifyCheque(marker) {
  const rows = await sql`select id, cheque_number, amount, cheque_date from cheque_register where cheque_number = ${`TC-${marker}`}`;
  check("cheque: exactly one cheque registered", rows.length === 1, rows.map((r) => `${r.cheque_number} ${r.amount}`).join(", ") || "none");
  if (rows.length !== 1) return;
  const chq = rows[0];
  check("cheque: amount is 15", Number(chq.amount) === 15, `found ${chq.amount}`);
  const chequeDate = chq.cheque_date instanceof Date ? chq.cheque_date.toISOString().slice(0, 10) : String(chq.cheque_date);
  check("cheque: dated today", chequeDate === out.today, `found ${chequeDate}`);
  const audit = await sql`select count(*)::int as n from audit_logs where entity = 'cheque' and summary like ${`TC-${marker}%`}`;
  check("cheque: audit entry recorded", audit[0].n === 1, `found ${audit[0].n}`);
}

async function verifyLedger(marker) {
  const contact = row(await sql`select id from contacts where display_name = ${`TL-${marker}`}`);
  check("ledger: contact created exactly once", !!contact);
  if (contact) {
    const dupes = await sql`select count(*)::int as n from contacts where display_name = ${`TL-${marker}`}`;
    check("ledger: no duplicate contact rows", dupes[0].n === 1);
  }
  const note = `ledger-test-${marker}`;
  const docs = await sql`
    select d.id, d.number, d.status, d.grand_total, dt.code from documents d
    join document_types dt on dt.id = d.document_type_id
    where d.reason = ${note}
  `;
  check("ledger: exactly one journal document for the note", docs.length === 1, docs.map((d) => `${d.code} ${d.number}`).join(", ") || "none");
  if (docs.length !== 1) return;
  const doc = docs[0];
  check("ledger: document is a posted journal entry", doc.code === "JOURNAL_ENTRY" && doc.status === "posted", `${doc.code}/${doc.status}`);
  if (contact) {
    const linked = row(await sql`select contact_id from documents where id = ${doc.id}`);
    check("ledger: document points at the contact", linked?.contact_id === contact.id);
  }
  const ledger = await ledgerFor(doc.id);
  check("ledger: one ledger row of 77", ledger.length === 1 && Number(ledger[0].debit) === 77, JSON.stringify(ledger));
  // The ledger entry audits without an entity id, keyed by the contact's name.
  const audit = await sql`select count(*)::int as n from audit_logs where entity = 'ledger entry' and summary = ${`TL-${marker}`} and created_at >= current_date`;
  check("ledger: audit entry recorded", audit[0].n >= 1, `found ${audit[0].n}`);
}

async function verifyExpense(marker) {
  // Used after scripts/dup-test.mjs (expense batch): notes carry the marker.
  const rows = await sql`select id, amount from expenses where notes = ${marker}`;
  check("expense: exactly one expense for the marker", rows.length === 1, rows.map((r) => `${r.id.slice(0, 8)} ${r.amount}`).join(", ") || "none");
  if (rows.length === 1) {
    const audit = await sql`select count(*)::int as n from audit_logs where entity = 'expense' and detail like ${`Total ${Number(rows[0].amount)}%`} and created_at >= current_date`;
    check("expense: audit entry recorded", audit[0].n >= 1, `found ${audit[0].n}`);
  }
}

const VERIFIERS = {
  sale: verifySale,
  purchase: verifyPurchase,
  payment: verifyPayment,
  cashtransfer: verifyCashTransfer,
  transfer: verifyStockTransfer,
  adjustment: verifyAdjustment,
  intercompany: verifyInterCompany,
  quotation: verifyQuotation,
  cheque: verifyCheque,
  ledger: verifyLedger,
  expense: verifyExpense,
};

// --- run --------------------------------------------------------------------
console.log(`verify-db: ${out.results.length} flow result(s), mode=${out.mode}, marker=${out.marker}\n`);
for (const r of out.results) {
  const fn = VERIFIERS[r.name];
  if (!fn) {
    console.log(`skip ${r.name}: no verifier`);
    continue;
  }
  console.log(`--- ${r.name} (${r.mode}) ---`);
  await fn(r.marker);
  console.log();
}

// Claim semantics themselves (fresh claim, replay refused, rolled-back claim
// retryable, 24h prune) are proven by lib/actions/operation-id.check.ts against
// this same database — the flow-level proof here is that every successful
// create produced exactly one logical transaction.

await sql.end();
console.log(failures === 0 ? "\nALL DB CHECKS PASSED" : `\n${failures} DB CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
