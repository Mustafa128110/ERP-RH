import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "./index";
import { sessionQuery } from "./session-query";
import { recordReferences } from "@/lib/queries/record-references";
import { readPartySettlement } from "@/lib/queries/party-ledger";
import { writeStockRows } from "@/lib/queries/stock-writes";

async function main() {
  const companies = await db.execute<{ id: string; name: string }>(sql`SELECT id,name FROM companies`);
  assert.equal(companies.length, 1);
  assert.equal(companies[0].name, "Royal Hardware");
  const company = companies[0].id;
  const [integrity] = await db.execute<{ missing: number; invalid: number }>(sql`SELECT
    (SELECT count(*)::int FROM documents d LEFT JOIN sales_channels c ON c.id=d.sale_type WHERE c.id IS NULL) AS missing,
    (SELECT count(*)::int FROM pg_constraint WHERE connamespace='public'::regnamespace AND NOT convalidated) AS invalid`);
  assert.equal(integrity.missing, 0);
  assert.equal(integrity.invalid, 0);
  const [opening] = await db.execute<{ contact: string; signed: number }>(sql`SELECT d.contact_id AS contact,sum(le.debit-le.credit)::float8 AS signed FROM documents d JOIN document_types dt ON dt.id=d.document_type_id JOIN ledger_entries le ON le.document_id=d.id WHERE dt.code='OPENING_BALANCE' AND d.status='posted' GROUP BY d.contact_id HAVING count(DISTINCT d.id)>1 LIMIT 1`);
  if (opening) assert.equal((await readPartySettlement(db, company, opening.contact)).openingSigned, opening.signed, "all preserved former-company opening documents must contribute to the account");

  const rollback = new Error("rollback verification fixtures");
  try {
    await db.transaction(async (tx) => {
      const [user] = await tx.execute<{ id: string; auth: string }>(sql`SELECT u.id,u.supabase_auth_id AS auth FROM users u WHERE EXISTS(SELECT 1 FROM user_roles r WHERE r.user_id=u.id) LIMIT 1`);
      assert.ok(user);
      await tx.execute(sql`DELETE FROM user_company_access WHERE user_id=${user.id}::uuid`);
      const [session] = await sessionQuery(user.auth, tx);
      assert.deepEqual(session.company_ids, [company], "an assigned role must provide access to the single company even if the legacy membership row is missing");
      assert.ok(session.perms.length > 0);

      const item = randomUUID();
      await tx.execute(sql`INSERT INTO items(id,company_id,sku,name) VALUES (${item}::uuid,${company}::uuid,${`CHECK-${item}`},'Deletion verification fixture')`);
      assert.deepEqual(await recordReferences(tx, "items", [item]), []);
      const [rule] = await tx.execute<{ id: string }>(sql`SELECT id FROM unit_conversions LIMIT 1`);
      if (rule) {
        await tx.execute(sql`INSERT INTO item_unit_conversion_rules(item_id,rule_id) VALUES (${item}::uuid,${rule.id}::uuid)`);
        assert.ok((await recordReferences(tx, "items", [item])).some((reference) => reference.table === "public.item_unit_conversion_rules"), "cascade setup links also count as references");
        await tx.execute(sql`DELETE FROM item_unit_conversion_rules WHERE item_id=${item}::uuid`);
      }
      const contact = randomUUID();
      await tx.execute(sql`INSERT INTO contacts(id,company_id,display_name) VALUES (${contact}::uuid,${company}::uuid,'Contact deletion verification fixture')`);
      assert.deepEqual(await recordReferences(tx, "contacts", [contact]), []);
      const [document] = await tx.execute<{ id: string }>(sql`INSERT INTO documents(company_id,document_type_id,number,document_date,contact_id,sale_type)
        SELECT ${company}::uuid,id,${`CHECK-${contact}`},current_date,${contact}::uuid,'counter' FROM document_types WHERE company_id=${company}::uuid LIMIT 1 RETURNING id`);
      assert.ok((await recordReferences(tx, "contacts", [contact])).some((reference) => reference.table === "public.documents"));
      const line = { companyId: company, documentId: document.id, itemId: item, lineNo: 1, quantity: "2", baseQuantity: "2", stockMovement: 1 };
      await writeStockRows(tx, [{ line, movement: 1, unitCost: 10 }]);
      await writeStockRows(tx, [{ line: { ...line, lineNo: 2 }, movement: 1, unitCost: 10 }], false);
      const [movement] = await tx.execute<{ count: number; quantity: number; value: number }>(sql`SELECT count(*)::int AS count,sum(it.base_quantity)::float8 AS quantity,sum(it.total_cost)::float8 AS value FROM inventory_transactions it JOIN document_lines dl ON dl.id=it.document_line_id WHERE dl.document_id=${document.id}::uuid`);
      assert.deepEqual(movement, { count: 1, quantity: 2, value: 20 }, "pending stock rows must not post movements; posted rows retain their cost");
      assert.ok((await recordReferences(tx, "items", [item])).some((reference) => reference.table === "public.document_lines"));
      throw rollback;
    });
  } catch (error) { if (error !== rollback) throw error; }
  console.log("single-company, missing-membership recovery, channel integrity, and full-reference deletion checks passed (fixtures rolled back)");
  await db.$client.end();
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
