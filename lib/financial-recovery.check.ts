import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { db } from "./db";
import { executeCommand } from "./command-executor";
import { encodeArgument, type SavedCommand } from "./command-protocol";
import { runAsWhatsAppUser } from "./whatsapp-agent/context";
import { sessionQuery } from "./db/session-query";
import type { AuthSession } from "./auth/session";
import { listLedgerBalances } from "./actions/ledger";

async function main() {
  const target = new URL(process.env.DATABASE_URL_DIRECT!);
  assert.equal(target.hostname, "127.0.0.1", "Financial fixtures must never write to a hosted database");
  assert.match(target.pathname, /^\/restore_\d+$/);
  const [user] = await db.execute<{ id: string; auth: string }>(sql`SELECT id, supabase_auth_id AS auth FROM users WHERE status='active' ORDER BY created_at LIMIT 1`);
  async function currentSession(): Promise<AuthSession> {
    const [row] = await sessionQuery(user.auth);
    return { userId: row.id, supabaseAuthId: row.supabase_auth_id, name: row.name, email: row.email, roleNames: row.role_names,
      globalPermissions: new Set(row.perms.filter(p => p.companyId === null).map(p => p.key)),
      permissionsByCompany: new Map(row.company_ids.map(id => [id, new Set(row.perms.filter(p => p.companyId === id).map(p => p.key))])),
      companyIds: row.company_ids, warehouseIds: row.warehouse_ids, uiTheme: row.ui_theme, uiScale: row.ui_scale };
  }
  const session = await currentSession();
  const company = session.companyIds[0];
  const [item] = await db.execute<{ id: string; unit: string }>(sql`SELECT id,base_unit_id AS unit FROM items WHERE company_id=${company}::uuid AND base_unit_id IS NOT NULL LIMIT 1`);
  const [cash] = await db.execute<{ id: string }>(sql`SELECT id FROM cash_accounts WHERE company_id=${company}::uuid AND is_active LIMIT 1`);
  const [purchaseType] = await db.execute<{ id: string }>(sql`SELECT id FROM document_types WHERE company_id=${company}::uuid AND code='PURCHASE_INVOICE' LIMIT 1`);
  const [location] = await db.execute<{ id: string }>(sql`SELECT id FROM locations WHERE location_type='shop' LIMIT 1`);
  const contactId = crypto.randomUUID();
  await db.execute(sql`INSERT INTO contacts(id,company_id,display_name) VALUES (${contactId}::uuid,${company}::uuid,'Disposable durability fixture')`);
  function command(action: string, raw: unknown[]): SavedCommand {
    return { id: crypto.randomUUID(), userId: user.id, action, args: raw.map(encodeArgument), version: 1, path: "/", label: "Disposable financial check", status: "pending", attempts: 0, createdAt: Date.now(), updatedAt: Date.now() };
  }
  function form(extra: Record<string, string> = {}) {
    const fd = new FormData();
    for (const [key, value] of Object.entries({companyId: company,contactId,locationId:location.id,documentDate: "2026-09-11",isPaid:"no",documentTypeId:purchaseType.id,
      linesJson:JSON.stringify([{itemId:item.id,unitId:item.unit,quantity:"2",unitPrice:"10",unitCost:"5"}]),...extra})) fd.set(key,value);
    return fd;
  }
  const send = async (entry: SavedCommand) => runAsWhatsAppUser(await currentSession(), () => executeCommand(entry, user.id));
  async function fingerprint() {
    const [row] = await db.execute(sql`SELECT jsonb_build_object(
      'documents',(SELECT md5(coalesce(string_agg(to_jsonb(t)::text,'' ORDER BY id),'')) FROM documents t),
      'lines',(SELECT md5(coalesce(string_agg(to_jsonb(t)::text,'' ORDER BY id),'')) FROM document_lines t),
      'stock',(SELECT md5(coalesce(string_agg(to_jsonb(t)::text,'' ORDER BY id),'')) FROM inventory_transactions t),
      'ledger',(SELECT md5(coalesce(string_agg(to_jsonb(t)::text,'' ORDER BY id),'')) FROM ledger_entries t),
      'expenses',(SELECT md5(coalesce(string_agg(to_jsonb(t)::text,'' ORDER BY id),'')) FROM expenses t),
      'cash',(SELECT md5(coalesce(string_agg(to_jsonb(t)::text,'' ORDER BY id),'')) FROM cash_accounts t),
      'allocations',(SELECT md5(coalesce(string_agg(to_jsonb(t)::text,'' ORDER BY id),'')) FROM payment_allocations t),
      'receipts',(SELECT md5(coalesce(string_agg(to_jsonb(t)::text,'' ORDER BY id),'')) FROM command_receipts t)
    ) AS state`);
    return row.state;
  }
  const workflows = [
    command("sales.createSale", [null, form()]),
    command("purchases.createStockPurchase", [null, form()]),
    command("payments.createPayment", ["received", null, new FormData()]),
    command("expenses.createExpensesBatch", [[{companyId:company,expenseCategoryId:"",expenseCategoryName:"Disposable durability check",settlementType:"cash",cashAccountId:cash.id,bankAccountId:null,chequeId:null,amount:"3",expenseDate:"2026-09-11",notes:"Local restore fixture"}]]),
  ];
  const payment = new FormData();
  for(const [key,value] of Object.entries({companyId:company,contactId,paymentType:"cash",cashAccountId:cash.id,paymentDate:"2026-09-11",amount:"10"})) payment.set(key,value);
  workflows[2] = command("payments.createPayment", ["received", null, payment]);
  for (const entry of workflows) {
    const replies = await Promise.all([send(entry), send(entry)]);
    assert.equal(replies[0].outcome, "confirmed", `${entry.action}: ${JSON.stringify(replies[0].result)}`);
    assert.deepEqual(replies[0],replies[1],"two tabs must receive the same canonical result");
    const committed = await fingerprint();
    assert.deepEqual(await send(entry),replies[0],"lost acknowledgement replays the original receipt");
    assert.deepEqual(await fingerprint(),committed,"replay must not touch invoice, stock, money, allocation or receipt state");
  }
  const simultaneous = await Promise.all([send(command("sales.createSale",[null,form()])),send(command("sales.createSale",[null,form()]))]);
  assert.ok(simultaneous.every(reply=>reply.outcome==='confirmed'));
  assert.notEqual(simultaneous[0].result.id,simultaneous[1].result.id,"distinct sales receive distinct identities");
  const saleId = simultaneous[0].result.id as string;
  const [version] = await db.execute<{ revision: string }>(sql`SELECT xmin::text AS revision FROM documents WHERE id=${saleId}::uuid`);
  const edit = command("sales.updateSale",[saleId,null,form()]);
  edit.revisions = { [`documents:${saleId}`]:version.revision };
  await db.execute(sql`UPDATE document_lines SET quantity=quantity WHERE document_id=${saleId}::uuid`);
  const newer = await fingerprint();
  assert.equal((await send(edit)).outcome,"refused","a child-only change invalidates the parent editor version");
  assert.deepEqual(await fingerprint(),newer);
  // The failure occurs after a document header has been written, inside its
  // line insert. The outer receipt transaction must roll back every side effect.
  await db.execute(sql`CREATE FUNCTION public.durability_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Injected write interruption'; END $$; CREATE TRIGGER durability_failure BEFORE INSERT ON document_lines FOR EACH STATEMENT EXECUTE FUNCTION public.durability_failure()`);
  const failed = command("sales.createSale",[null,form()]);
  const before = await fingerprint();
  const refused = await send(failed);
  assert.equal(refused.outcome,"refused");
  assert.deepEqual(await fingerprint(),before,"interrupted line insert rolls back all financial effects and the receipt");
  await db.execute(sql`DROP TRIGGER durability_failure ON document_lines; DROP FUNCTION public.durability_failure()`);
  assert.equal((await send(failed)).outcome,"confirmed","the same operation can retry after rollback");
  // Revocation after local enqueue is resolved against real role permissions.
  const queued = command("sales.createSale",[null,form()]);
  const removed = await db.execute<{role_id:string;permission_id:string}>(sql`DELETE FROM role_permissions rp USING permissions p WHERE rp.permission_id=p.id AND p.module='sales' AND p.action='create' RETURNING rp.role_id,rp.permission_id`);
  try {
    const revokedState = await fingerprint();
    assert.equal((await send(queued)).outcome,"refused");
    assert.deepEqual(await fingerprint(),revokedState,"revoked access cannot leave a receipt or any financial writes");
  } finally {
    if (removed.length) await db.execute(sql`INSERT INTO role_permissions(role_id,permission_id) VALUES ${sql.join(removed.map(row=>sql`(${row.role_id}::uuid,${row.permission_id}::uuid)`),sql`, `)}`);
  }
  const balances = await runAsWhatsAppUser(await currentSession(), () => listLedgerBalances());
  const party = balances.find(row => row.contactId === contactId && row.companyId === company);
  assert.ok(party);
  assert.ok(party.recentInvoices.length > 0 && party.recentInvoices.length <= 6, "ledger response retains its bounded invoice hover history");
  assert.ok(party.recentPurchases.length > 0 && party.recentPurchases.length <= 6, "ledger response retains its bounded purchase hover history");
  assert.ok(party.recentInvoices.every(invoice => invoice.items.length > 0), "actual invoice lines reach the hover panel");
  console.log("Financial recovery checks passed on disposable restore: real sale, purchase, payment and expense actions; concurrent same-operation saves; lost acknowledgements; interrupted transaction rollback and retry; permission revocation; ledger hover history");
}
main().finally(() => db.$client.end()).catch(error => { console.error(error); process.exitCode=1; });
