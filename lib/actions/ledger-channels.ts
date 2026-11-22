"use server";
import {sql} from "drizzle-orm";
import {revalidatePath} from "next/cache";
import {db} from "@/lib/db";
import {contactLedgers} from "@/lib/db/schema";
import {getLiveSession,getSession} from "@/lib/auth/session";
import {requirePermission} from "@/lib/auth/permissions";
import {guard,DUPLICATE} from "@/lib/actions/guard";
import {recordAudit} from "@/lib/actions/audit";
import {claimOperation,DuplicateOperationError} from "@/lib/actions/operation-id";
import {ensureDocumentType} from "@/lib/actions/document-numbering";
import {resolveChannel} from "@/lib/queries/channels";
import {CACHE,invalidateLookups,invalidateReads,READ_DOMAIN} from "@/lib/queries/lookups";
import {mergeLedgerRows,closeLedgerRows,type LedgerMergeInput} from "@/lib/queries/ledger-channels";

const READS=[READ_DOMAIN.ledger,READ_DOMAIN.sales,READ_DOMAIN.purchases,READ_DOMAIN.payments,READ_DOMAIN.products,READ_DOMAIN.stock,READ_DOMAIN.accounts,READ_DOMAIN.contacts] as const;
async function invalidateLedgerChanges(){await invalidateLookups(CACHE.contactLedgers,CACHE.documentTypes);await invalidateReads(...READS);revalidatePath("/ledger");}

export async function listContactLedgers(companyId:string,contactId:string){
 const session=await getSession();requirePermission(session,"accounts","view",{companyId});
 return [...await db.execute<{channelId:string;name:string;isActive:boolean;closedAt:string|null;balance:string;entries:number}>(sql`
 SELECT cl.channel_id AS "channelId",sc.name,cl.is_active AS "isActive",cl.closed_at::text AS "closedAt",
  coalesce(t.balance,0)::text AS balance,coalesce(t.entries,0)::int AS entries
 FROM contact_ledgers cl JOIN sales_channels sc ON sc.id=cl.channel_id
 LEFT JOIN LATERAL(SELECT sum(le.debit-le.credit) AS balance,count(*) AS entries FROM ledger_entries le JOIN documents d ON d.id=le.document_id
  WHERE d.company_id=cl.company_id AND d.contact_id=cl.contact_id AND d.sale_type=cl.channel_id AND d.status='posted') t ON true
 WHERE cl.company_id=${companyId}::uuid AND cl.contact_id=${contactId}::uuid AND (cl.is_active OR coalesce(t.entries,0)>0)
 ORDER BY sc.name`)];
}

export async function createContactLedger(companyId:string,contactId:string,channelId:string,operationId:string){
 return guard("Couldn't create the contact ledger.",async()=>{
  const session=await getLiveSession();requirePermission(session,"accounts","create",{companyId});
  await resolveChannel(channelId);
  await db.transaction(async tx=>{if(!await claimOperation(tx,operationId))throw new DuplicateOperationError();await tx.insert(contactLedgers).values({companyId,contactId,channelId}).onConflictDoUpdate({target:[contactLedgers.companyId,contactLedgers.contactId,contactLedgers.channelId],set:{isActive:true}});});
  await invalidateLedgerChanges();await recordAudit({action:"create",entity:"contact ledger",entityId:contactId,companyId,summary:"Channel ledger opened",detail:channelId});return {success:true};
 });
}

export async function mergeContactLedgers(input:LedgerMergeInput){
 return guard("Couldn't merge the contact ledgers.",async()=>{
  const {companyId,contactId,targetChannel}=input;
  const session=await getLiveSession();requirePermission(session,"accounts","edit",{companyId});
  const sources=[...new Set(input.sourceChannels)].filter(channel=>channel!==targetChannel);
  if(!sources.length)return {error:"Choose one or more different source ledgers."};
  await resolveChannel(targetChannel);
  const result=await db.transaction(tx=>mergeLedgerRows(tx,input));
  await invalidateLedgerChanges();await recordAudit({action:"merge",entity:"contact ledger",entityId:contactId,companyId,summary:`${result.documents} transaction(s) moved to one ledger`,detail:JSON.stringify({sources,targetChannel,documents:result.documentIds,scope:"complete ledgers"})});return {success:true,documents:result.documents};
 });
}

export async function closeContactLedger(input:{companyId:string;contactId:string;channelId:string;operationId:string;note?:string}){
 return guard("Couldn't close the ledger balance.",async()=>{
  const {companyId,contactId,channelId}=input;
  const session=await getLiveSession();requirePermission(session,"accounts","create",{companyId});
  const type=await ensureDocumentType({companyId,code:"LEDGER_CLOSING",name:"Ledger Closing",series:"LC",affectsAccounting:true,active:true});
  const result=await db.transaction(tx=>closeLedgerRows(tx,{...input,userId:session.userId,documentTypeId:type.id,series:type.series}));
  await invalidateLedgerChanges();await recordAudit({action:"update",entity:"ledger closing",entityId:contactId,companyId,summary:"Ledger balance closed to zero",detail:JSON.stringify({channelId,previousBalance:result.previousBalance,note:input.note??null,preserved:"All entries and settlements; no cash or bank balance moved"})});return {success:true};
 },{[DUPLICATE]:"The closing entry number is already in use; please retry."});
}
