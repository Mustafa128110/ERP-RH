import "server-only";
import {sql} from "drizzle-orm";
import {db} from "@/lib/db";
export type ChannelOpening={documentId:string|null;signedAmount:number;editableSignedAmount:number;additionalSignedAmount:number;date:string|null;note:string|null};
export async function readChannelOpening(runner:Pick<typeof db,"execute">,companyId:string,contactId:string,channelId:string):Promise<ChannelOpening>{
 const [row]=await runner.execute<{documentId:string|null;signedAmount:number;editableSignedAmount:number;date:string|null;note:string|null}>(sql`
 SELECT current.document_id AS "documentId",totals.amount::float8 AS "signedAmount",coalesce(current.amount,0)::float8 AS "editableSignedAmount",current.document_date::text AS date,current.reason AS note
 FROM (SELECT coalesce(sum(le.debit-le.credit),0) AS amount FROM documents d JOIN document_types dt ON dt.id=d.document_type_id JOIN ledger_entries le ON le.document_id=d.id
  WHERE d.company_id=${companyId}::uuid AND d.contact_id=${contactId}::uuid AND d.sale_type=${channelId} AND d.status='posted' AND d.ledger_closed_at IS NULL AND dt.code IN ('OPENING_BALANCE','JOURNAL_ENTRY')) totals
 LEFT JOIN LATERAL(SELECT d.id AS document_id,d.document_date,d.reason,coalesce(le.debit-le.credit,0) AS amount FROM contact_opening_balances b JOIN documents d ON d.id=b.document_id LEFT JOIN ledger_entries le ON le.document_id=d.id
  WHERE b.company_id=${companyId}::uuid AND b.contact_id=${contactId}::uuid AND b.channel_id=${channelId} AND d.sale_type=${channelId} AND d.status='posted' AND d.ledger_closed_at IS NULL LIMIT 1) current ON true`);
 return {...row,additionalSignedAmount:Math.round((row.signedAmount-row.editableSignedAmount)*100)/100};
}
export function canonicalOpeningAmount(target:number,additional:number){return Math.round((target-additional)*100)/100;}
