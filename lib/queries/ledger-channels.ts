import "server-only";
import {OperationError} from "@/lib/operation-errors";
import {and,eq,inArray,isNull,sql} from "drizzle-orm";
import {db} from "@/lib/db";
import {contactLedgers,documents,ledgerEntries,documentNumberLedger,documentTypes} from "@/lib/db/schema";
import {claimOperation,DuplicateOperationError} from "@/lib/actions/operation-id";
import {nextDocumentNumber} from "@/lib/db/document-numbers";
type Tx=Parameters<Parameters<typeof db.transaction>[0]>[0];
const members=(ids:string[])=>sql.join(ids.map(id=>sql`${id}::uuid`),sql`, `);
export type LedgerMergeInput={companyId:string;contactId:string;sourceChannels:string[];targetChannel:string;operationId:string};
export async function mergeLedgerRows(tx:Tx,input:LedgerMergeInput){
 // Refuse old queued partial requests rather than silently expanding their scope.
 if("entryIds" in input)throw new OperationError("Partial ledger merges are no longer available. Refresh and choose complete ledgers to merge.");
 const {companyId,contactId,targetChannel,operationId}=input;
 const sources=[...new Set(input.sourceChannels)].filter(channel=>channel!==targetChannel);

   if(!await claimOperation(tx,operationId))throw new DuplicateOperationError();
   await tx.insert(contactLedgers).values({companyId,contactId,channelId:targetChannel}).onConflictDoUpdate({target:[contactLedgers.companyId,contactLedgers.contactId,contactLedgers.channelId],set:{isActive:true}});
   const ledgers=await tx.select().from(contactLedgers).where(and(eq(contactLedgers.companyId,companyId),eq(contactLedgers.contactId,contactId),inArray(contactLedgers.channelId,[...sources,targetChannel]))).orderBy(contactLedgers.channelId).for("update");
   if(!sources.length||sources.some(channel=>!ledgers.some(ledger=>ledger.channelId===channel)))throw new OperationError("A source ledger no longer exists. Refresh the ledger list and try again.");
   const selected=await tx.execute<{id:string;documentId:string}>(sql`SELECT le.id,d.id AS "documentId" FROM ledger_entries le JOIN documents d ON d.id=le.document_id
    WHERE d.company_id=${companyId}::uuid AND d.contact_id=${contactId}::uuid AND d.sale_type IN (${sql.join(sources.map(channel=>sql`${channel}`),sql`,`)})
    FOR UPDATE OF d`);
   const ids=[...new Set(selected.map(row=>row.documentId))];
   if(ids.length){
    // The pointer is an editable lookup, never the opening balance itself. Keep
    // all opening documents and archive only redundant lookup pointers.
    const candidates=sql`SELECT b.*,row_number() OVER(ORDER BY (b.channel_id=${targetChannel}) DESC,b.document_id) AS rank FROM contact_opening_balances b
      WHERE b.company_id=${companyId}::uuid AND b.contact_id=${contactId}::uuid AND (b.channel_id=${targetChannel} OR b.document_id IN (${members(ids)}))`;
    await tx.execute(sql`WITH candidates AS (${candidates}) INSERT INTO consolidation_history(kind,source_id,target_id,original)
      SELECT 'ledger opening index merge',${operationId}||':'||document_id::text,${targetChannel},to_jsonb(candidates)-'rank' FROM candidates WHERE rank>1`);
    await tx.execute(sql`WITH candidates AS (${candidates}) DELETE FROM contact_opening_balances b USING candidates c WHERE c.rank>1 AND b.document_id=c.document_id`);
    await tx.execute(sql`UPDATE contact_opening_balances SET channel_id=${targetChannel} WHERE document_id IN (${members(ids)})`);
    await tx.update(documents).set({saleType:targetChannel,updatedAt:new Date()}).where(inArray(documents.id,ids));
   }
   await tx.execute(sql`UPDATE contact_ledgers cl SET is_active=false WHERE company_id=${companyId}::uuid AND contact_id=${contactId}::uuid
    AND channel_id IN (${sql.join(sources.map(channel=>sql`${channel}`),sql`,`)}) AND NOT EXISTS(SELECT 1 FROM documents d JOIN ledger_entries le ON le.document_id=d.id
      WHERE d.company_id=cl.company_id AND d.contact_id=cl.contact_id AND d.sale_type=cl.channel_id)`);
   return {success:true,documents:ids.length,documentIds:ids};
}
export type LedgerCloseInput={companyId:string;contactId:string;channelId:string;operationId:string;note?:string;userId:string;documentTypeId:typeof documentTypes.$inferSelect.id;series:typeof documentTypes.$inferSelect.series};
export async function closeLedgerRows(tx:Tx,input:LedgerCloseInput){
 const {companyId,contactId,channelId,operationId}=input;

   if(!await claimOperation(tx,operationId))throw new DuplicateOperationError();
   const [ledger]=await tx.select().from(contactLedgers).where(and(eq(contactLedgers.companyId,companyId),eq(contactLedgers.contactId,contactId),eq(contactLedgers.channelId,channelId))).for("update");
   if(!ledger)throw new OperationError("That contact ledger no longer exists.");
   await tx.select({id:documents.id}).from(documents).where(and(eq(documents.companyId,companyId),eq(documents.contactId,contactId),eq(documents.saleType,channelId))).orderBy(documents.id).for("update");
   const [total]=await tx.execute<{balance:string}>(sql`SELECT coalesce(sum(le.debit-le.credit),0)::text AS balance FROM ledger_entries le JOIN documents d ON d.id=le.document_id
    WHERE d.company_id=${companyId}::uuid AND d.contact_id=${contactId}::uuid AND d.sale_type=${channelId} AND d.status='posted'`);
   const balance=Number(total.balance),now=new Date();
   if(Math.abs(balance)>=0.005){
    const number=await nextDocumentNumber(input.series,tx),amount=Math.abs(balance).toFixed(2);
    const [document]=await tx.insert(documents).values({companyId,contactId,saleType:channelId,documentTypeId:input.documentTypeId,number,documentDate:sql`(now() AT TIME ZONE 'Asia/Karachi')::date`,status:"posted",subtotal:amount,grandTotal:amount,reason:`Ledger closing${input.note?`: ${input.note.trim()}`:""}`,createdBy:input.userId}).returning({id:documents.id});
    await tx.insert(documentNumberLedger).values({companyId,documentTypeId:input.documentTypeId,number,documentId:document.id});
    await tx.insert(ledgerEntries).values({companyId,documentId:document.id,...balance>0?{credit:amount}:{debit:amount}});
   }
   // Retain previous settlements and stop a future payment from being offered
   // to a closed period. Backdated new transactions still start a new period.
   await tx.update(documents).set({ledgerClosedAt:now}).where(and(eq(documents.companyId,companyId),eq(documents.contactId,contactId),eq(documents.saleType,channelId),eq(documents.status,"posted"),isNull(documents.ledgerClosedAt)));
   await tx.update(contactLedgers).set({closedAt:now,isActive:true}).where(and(eq(contactLedgers.companyId,companyId),eq(contactLedgers.contactId,contactId),eq(contactLedgers.channelId,channelId)));
   return {success:true,previousBalance:total.balance};
}
