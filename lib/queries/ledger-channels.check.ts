import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {sql} from "drizzle-orm";
import {db} from "@/lib/db";
import {documents,ledgerEntries,contacts,salesChannels,documentTypes,contactOpeningBalances,paymentAllocations} from "@/lib/db/schema";
import {readChannelOpening,canonicalOpeningAmount} from "./channel-opening";
import {mergeLedgerRows,closeLedgerRows} from "./ledger-channels";
import {readPartySettlement} from "./party-ledger";
import {allocatePaymentsFifo} from "@/lib/actions/payment-allocation";
import {OperationError} from "@/lib/operation-errors";
import {DuplicateOperationError} from "@/lib/actions/operation-id";
async function main(){
 const rollback=new Error("rollback ledger fixtures");
 try{await db.transaction(async tx=>{
  const [company]=await tx.execute<{id:string}>(sql`SELECT id FROM companies LIMIT 1`),[user]=await tx.execute<{id:string}>(sql`SELECT id FROM users LIMIT 1`),[cash]=await tx.execute<{id:string}>(sql`SELECT id FROM cash_accounts WHERE company_id=${company.id}::uuid LIMIT 1`);
  const types=await tx.select().from(documentTypes),type=(code:string)=>types.find(type=>type.companyId===company.id&&type.code===code)!;
  const [closing]=await tx.insert(documentTypes).values({companyId:company.id,code:"LEDGER_CLOSING",name:"QA ledger closing",series:"LC",affectsAccounting:true}).onConflictDoUpdate({target:[documentTypes.companyId,documentTypes.code],set:{code:sql`excluded.code`}}).returning();
  const suffix=randomUUID(),a=`qa-a-${suffix}`,b=`qa-b-${suffix}`,c=`qa-c-${suffix}`,empty=`qa-empty-${suffix}`;
  await tx.insert(salesChannels).values([a,b,c,empty].map((id,index)=>({id,name:`QA ledger ${index} ${suffix}`})));
  const [contact]=await tx.insert(contacts).values({companyId:company.id,displayName:`QA ledger ${suffix}`}).returning();
  const sale=randomUUID(),other=randomUUID(),payment=randomUUID(),shop=randomUUID(),openingA=randomUUID(),openingB=randomUUID();
  await tx.insert(documents).values([
   {id:sale,companyId:company.id,documentTypeId:type("SALES_INVOICE").id,number:`QA-S-${suffix}`,documentDate:"2026-01-01",contactId:contact.id,saleType:a,status:"posted",grandTotal:"1000",paidAmount:"550",cashAccountId:cash.id},
   {id:other,companyId:company.id,documentTypeId:type("SALES_INVOICE").id,number:`QA-O-${suffix}`,documentDate:"2026-01-02",contactId:contact.id,saleType:a,status:"posted",grandTotal:"200"},
   {id:payment,companyId:company.id,documentTypeId:type("PAYMENT_RECEIVED").id,number:`QA-P-${suffix}`,documentDate:"2026-01-03",contactId:contact.id,saleType:a,status:"posted",grandTotal:"350",cashAccountId:cash.id},
   {id:shop,companyId:company.id,documentTypeId:type("SALES_INVOICE").id,number:`QA-B-${suffix}`,documentDate:"2026-01-04",contactId:contact.id,saleType:b,status:"posted",grandTotal:"500"},
   ...[{id:openingA,channel:a,total:"100"},{id:openingB,channel:b,total:"200"}].map(row=>({id:row.id,companyId:company.id,documentTypeId:type("OPENING_BALANCE").id,number:`QA-${row.id}`,documentDate:"2025-01-01",contactId:contact.id,saleType:row.channel,status:"posted" as const,grandTotal:row.total})),
  ]);
  const sourceEntry=randomUUID();
  await tx.insert(ledgerEntries).values([{id:sourceEntry,companyId:company.id,documentId:sale,debit:"1000"},{companyId:company.id,documentId:sale,credit:"200"},{companyId:company.id,documentId:other,debit:"200"},{companyId:company.id,documentId:payment,credit:"350"},{companyId:company.id,documentId:shop,debit:"500"},{companyId:company.id,documentId:openingA,debit:"100"},{companyId:company.id,documentId:openingB,debit:"200"}]);
  await tx.insert(contactOpeningBalances).values([{companyId:company.id,contactId:contact.id,channelId:a,documentId:openingA},{companyId:company.id,contactId:contact.id,channelId:b,documentId:openingB}]);
  await tx.insert(paymentAllocations).values({companyId:company.id,paymentDocumentId:payment,invoiceDocumentId:sale,amount:"350"});
  const [allocationBefore]=await tx.execute<{digest:string}>(sql`SELECT md5(to_jsonb(pa)::text) AS digest FROM payment_allocations pa WHERE payment_document_id=${payment}::uuid`);
  const [cashBefore]=await tx.execute<{balance:string}>(sql`SELECT current_balance::text AS balance FROM cash_accounts WHERE id=${cash.id}::uuid`);
  const mergeInput={companyId:company.id,contactId:contact.id,sourceChannels:[a],targetChannel:b,operationId:randomUUID()};
  await assert.rejects(()=>tx.transaction(nested=>mergeLedgerRows(nested,{...mergeInput,entryIds:[sourceEntry]} as typeof mergeInput)),/Partial ledger merges are no longer available/,"stale partial requests cannot become full merges");
  const [untouched]=await tx.execute<{channel:string}>(sql`SELECT sale_type AS channel FROM documents WHERE id=${sale}::uuid`);
  assert.equal(untouched.channel,a,"refused partial requests do not move anything");
  const merged=await mergeLedgerRows(tx,mergeInput);
  assert.equal(merged.documents,4,"all source transactions move, including opening and payment documents");
  const [source]=await tx.execute<{active:boolean;entries:number}>(sql`SELECT is_active AS active,(SELECT count(*)::int FROM documents d JOIN ledger_entries le ON le.document_id=d.id WHERE d.contact_id=${contact.id}::uuid AND d.sale_type=${a}) AS entries FROM contact_ledgers WHERE contact_id=${contact.id}::uuid AND channel_id=${a}`);
  assert.deepEqual(source,{active:false,entries:0},"the full source ledger is emptied without deleting its history");
  const [paired]=await tx.execute<{count:number;channel:string}>(sql`SELECT count(*)::int AS count,max(d.sale_type) AS channel FROM ledger_entries le JOIN documents d ON d.id=le.document_id WHERE d.id=${sale}::uuid`);
  assert.deepEqual(paired,{count:2,channel:b},"the invoice and its counter payment move together");
  await mergeLedgerRows(tx,{companyId:company.id,contactId:contact.id,sourceChannels:[a,b],targetChannel:c,operationId:randomUUID()});
  const [beforeClose]=await tx.execute<{balance:number;entries:number;pointers:number}>(sql`SELECT sum(le.debit-le.credit)::float8 AS balance,count(*)::int AS entries,(SELECT count(*)::int FROM contact_opening_balances WHERE contact_id=${contact.id}::uuid) AS pointers FROM ledger_entries le JOIN documents d ON d.id=le.document_id WHERE d.contact_id=${contact.id}::uuid`);
  assert.deepEqual(beforeClose,{balance:1450,entries:7,pointers:1},"whole-ledger merge retains all financial rows and one editable opening pointer");
  const opening=await readChannelOpening(tx,company.id,contact.id,c);
  assert.equal(opening.signedAmount,300);assert.equal(canonicalOpeningAmount(400,opening.additionalSignedAmount)+opening.additionalSignedAmount,400,"an aggregate opening edit changes only its canonical portion and retains the other historical openings");
  const closeInput={companyId:company.id,contactId:contact.id,channelId:c,operationId:randomUUID(),userId:user.id,documentTypeId:closing.id,series:closing.series};
  await closeLedgerRows(tx,closeInput);
  const [closed]=await tx.execute<{balance:number;entries:number;active:boolean}>(sql`SELECT (SELECT sum(le.debit-le.credit)::float8 FROM ledger_entries le JOIN documents d ON d.id=le.document_id WHERE d.contact_id=${contact.id}::uuid) AS balance,(SELECT count(*)::int FROM ledger_entries le JOIN documents d ON d.id=le.document_id WHERE d.contact_id=${contact.id}::uuid) AS entries,(SELECT is_active FROM contact_ledgers WHERE contact_id=${contact.id}::uuid AND channel_id=${c}) AS active`);
  assert.deepEqual(closed,{balance:0,entries:8,active:true},"closing posts one adjustment and keeps the ledger and every old row");
  assert.equal((await readChannelOpening(tx,company.id,contact.id,c)).signedAmount,0,"closed openings are not reused in the future period");
  assert.equal((await readPartySettlement(tx,company.id,contact.id)).items.length,0,"a closed period is excluded from future FIFO");
  await assert.rejects(()=>tx.transaction(nested=>nested.execute(sql`UPDATE documents SET grand_total=grand_total+1 WHERE id=${sale}::uuid`)),error=>JSON.stringify(error).includes("P0076"),"closed financial history cannot be edited");
  await assert.rejects(()=>tx.transaction(nested=>nested.execute(sql`DELETE FROM ledger_entries WHERE document_id=${sale}::uuid`)),error=>JSON.stringify(error).includes("P0076"),"closed financial history cannot be deleted");
  const [checkpoint]=await tx.execute<{closed:string}>(sql`SELECT ledger_closed_at::text AS closed FROM documents WHERE id=${sale}::uuid`);
  await closeLedgerRows(tx,{...closeInput,operationId:randomUUID()});
  assert.deepEqual((await tx.execute(sql`SELECT ledger_closed_at::text AS closed FROM documents WHERE id=${sale}::uuid`))[0],checkpoint,"closing an empty new period retains the original checkpoint");
  assert.deepEqual((await tx.execute(sql`SELECT md5(to_jsonb(pa)::text) AS digest FROM payment_allocations pa WHERE payment_document_id=${payment}::uuid`))[0],allocationBefore);
  assert.deepEqual((await tx.execute(sql`SELECT current_balance::text AS balance FROM cash_accounts WHERE id=${cash.id}::uuid`))[0],cashBefore,"closing never changes actual cash");
  await assert.rejects(()=>closeLedgerRows(tx,closeInput),DuplicateOperationError);
  const future=randomUUID(),futurePayment=randomUUID();
  await tx.insert(documents).values([{id:future,companyId:company.id,contactId:contact.id,saleType:c,documentTypeId:type("SALES_INVOICE").id,number:`QA-F-${suffix}`,documentDate:"2020-01-01",status:"posted",grandTotal:"300"},{id:futurePayment,companyId:company.id,contactId:contact.id,saleType:c,documentTypeId:type("PAYMENT_RECEIVED").id,number:`QA-FP-${suffix}`,documentDate:"2020-01-02",status:"posted",grandTotal:"100",cashAccountId:cash.id}]);
  await tx.insert(ledgerEntries).values([{companyId:company.id,documentId:future,debit:"300"},{companyId:company.id,documentId:futurePayment,credit:"100"}]);
  await allocatePaymentsFifo(tx,[futurePayment]);
  const fresh=await tx.execute<{id:string;amount:number}>(sql`SELECT invoice_document_id AS id,amount::float8 AS amount FROM payment_allocations WHERE payment_document_id=${futurePayment}::uuid`);
  assert.deepEqual([...fresh],[{id:future,amount:100}],"future payments only settle the new period, including backdated new entries");
  await assert.rejects(()=>tx.transaction(nested=>mergeLedgerRows(nested,{companyId:company.id,contactId:contact.id,sourceChannels:[`qa-missing-${suffix}`],targetChannel:empty,operationId:randomUUID()})),OperationError);
  const [refused]=await tx.execute<{count:number}>(sql`SELECT count(*)::int AS count FROM contact_ledgers WHERE contact_id=${contact.id}::uuid AND channel_id=${empty}`);assert.equal(refused.count,0,"refused selection rolls back the operation and empty destination ledger");
  throw rollback;
 });}catch(error){if(error!==rollback)throw error;}
 console.log("complete-ledger merges, stale partial refusal, financial-history preservation, opening pointers, closing, replay and future-period checks passed (rolled back)");
}
main().finally(()=>db.$client.end()).catch(error=>{console.error(error);process.exitCode=1;});
