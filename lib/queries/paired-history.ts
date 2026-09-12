import 'server-only';
import {sql,type SQL} from 'drizzle-orm';
import {db} from '@/lib/db';
import {BANK_ACCOUNT_LABEL_SQL} from '@/lib/account-label';
import {listHistoryWindow,historyText as text,orderHistoryRecords} from './list-history';
import type {HistoryRequest} from '@/lib/history-window';

export async function pairedHistory<T extends {id:string}>(kind:'inter'|'cash',scope:SQL|undefined,request:HistoryRequest){
 const inter=kind==='inter';
 const source=sql`WITH sides AS (
  SELECT documents.id,documents.number,documents.document_date,documents.created_at,documents.status,documents.grand_total,
   coalesce(companies.short_name,companies.name) AS company,
   ${inter?sql`documents.reason`:sql`split_part(documents.reason,' ',4)`} AS pair,
   ${inter?sql`CASE WHEN document_types.code='SALES_INVOICE' THEN 'out' ELSE 'in' END`:sql`split_part(documents.reason,' ',3)`} AS side,
   coalesce(${sql.raw(BANK_ACCOUNT_LABEL_SQL())},cash_accounts.name,'—') AS account
  FROM documents JOIN document_types ON document_types.id=documents.document_type_id JOIN companies ON companies.id=documents.company_id
  LEFT JOIN bank_accounts ON bank_accounts.id=documents.bank_account_id LEFT JOIN cash_accounts ON cash_accounts.id=documents.cash_account_id
  WHERE ${scope??sql`true`} AND ${inter?sql`documents.reason LIKE 'Inter-Company %' AND document_types.code IN ('SALES_INVOICE','PURCHASE_INVOICE')`:sql`documents.reason LIKE 'Cash Transfer %' AND documents.status='posted'`}
 ), ranked AS (SELECT *,row_number() OVER(PARTITION BY pair,side ORDER BY created_at DESC,id) AS rank FROM sides)
 SELECT outgoing.id,outgoing.number AS ${sql.identifier(inter?'saleNumber':'number')},outgoing.document_date::text AS "documentDate",outgoing.created_at AS "createdAt",
 ${inter?sql`incoming.number AS "purchaseNumber",outgoing.company AS seller,incoming.company AS buyer,outgoing.status,outgoing.grand_total::text AS "grandTotal"`:
 sql`outgoing.company,outgoing.account AS "from",coalesce(incoming.account,'—') AS "to",outgoing.grand_total::text AS amount`}
 FROM ranked outgoing ${inter?sql`JOIN`:sql`LEFT JOIN`} ranked incoming ON incoming.pair=outgoing.pair AND incoming.side='in' AND incoming.rank=1
 WHERE outgoing.side='out' AND outgoing.rank=1 AND outgoing.pair<>''`;
 const names=inter?['id','saleNumber','documentDate','createdAt','purchaseNumber','seller','buyer','status','grandTotal']:['id','number','documentDate','createdAt','company','from','to','amount'];
 const fields:Record<string,SQL>={date:sql`max("documentDate")`,_date:sql`to_char(max("documentDate")::date,'DD-MM-YYYY')`};
 for(const name of names.filter(name=>!['id','documentDate','createdAt','grandTotal','amount'].includes(name)))fields[name]=text(name);
 fields[inter?'total':'amount']=sql`max(${sql.identifier(inter?'grandTotal':'amount')}::numeric)`;
 const window=await listHistoryWindow({getSQL:()=>source,getSelectedFields:()=>Object.fromEntries(names.map(name=>[name,{}]))} as Parameters<typeof listHistoryWindow>[0],request,{fields,order:sql`max("documentDate") DESC,max("createdAt") DESC`,aliases:{number:inter?'saleNumber':'number'}});
 const rows=window.ids.length?await db.execute<T>(sql`SELECT * FROM (${source}) paired WHERE id IN (${sql.join(window.ids.map(id=>sql`${id}::uuid`),sql`,`)})`):[];
 return {records:orderHistoryRecords([...rows],window.ids),info:window.info};
}
