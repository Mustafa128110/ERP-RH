import 'server-only';
import {sql,type SQLWrapper} from 'drizzle-orm';
import {db} from '@/lib/db';
import {HISTORY_PAGE_SIZE,type HistoryInfo} from '@/lib/history-window';
import type {LedgerHistoryRequest,LedgerHistorySummary} from '@/lib/ledger-history';

// Aggregate and walk the complete filtered statement before taking the page.
// Display direction changes row order, never the historical balance of a row.
export async function ledgerHistoryWindow(query:SQLWrapper,request:LedgerHistoryRequest){
 const names=Object.keys((query as SQLWrapper & {getSelectedFields():Record<string,unknown>}).getSelectedFields());
 const search=(request.query??'').trim().toLowerCase().slice(0,300);
 const page=Math.min(1000000,Math.max(1,Math.floor(request.page||1)));
 const direction=request.direction==='desc'?'desc':'asc';
 const from=request.from||null,to=request.to||null;
 const [result]=await db.execute<{selected:{id:string;balance:number}[];total:number;page:number;opening:number;totalDebit:number;totalCredit:number;openingBalance:number;openingDocumentId:string|null}>(sql`
 WITH source(${sql.join(names.map(name=>sql.identifier(name)),sql`,`)}) AS (${query.getSQL()}),
 active AS (SELECT * FROM source WHERE ${request.showCancelled?sql`true`:sql`"documentStatus"<>'cancelled'`}),
 matched AS (SELECT * FROM active WHERE (${from}::date IS NULL OR date>=${from}::date) AND (${to}::date IS NULL OR date<=${to}::date)
  AND (${search}='' OR position(${search} in lower(coalesce(number,'')))>0 OR EXISTS(
   SELECT 1 FROM document_lines dl JOIN items i ON i.id=dl.item_id WHERE dl.document_id=active."documentId" AND position(${search} in lower(i.name))>0))),
 totals AS (SELECT count(*)::int AS total,coalesce(sum(debit),0)::float8 AS "totalDebit",coalesce(sum(credit),0)::float8 AS "totalCredit",
  least(${page},greatest(1,ceil(count(*)::numeric/${HISTORY_PAGE_SIZE})))::int AS page FROM matched),
 opening AS (SELECT coalesce(sum(debit-credit) FILTER(WHERE date<${from}::date),0)::float8 AS opening,
  coalesce(sum(debit-credit) FILTER(WHERE code='OPENING_BALANCE'),0)::float8 AS "openingBalance",
  CASE WHEN count(*) FILTER(WHERE code='OPENING_BALANCE')=1 THEN max("documentId"::text) FILTER(WHERE code='OPENING_BALANCE') END AS "openingDocumentId" FROM active),
 running AS (SELECT "ledgerId" AS id,date,(opening.opening+sum(debit-credit) OVER(ORDER BY date,"ledgerId" ROWS UNBOUNDED PRECEDING))::float8 AS balance FROM matched CROSS JOIN opening),
 selected AS (SELECT * FROM running ORDER BY date ${sql.raw(direction)},id ${sql.raw(direction)}
  ${request.all?sql``:sql`LIMIT ${HISTORY_PAGE_SIZE} OFFSET (SELECT (page-1)*${HISTORY_PAGE_SIZE} FROM totals)`})
 SELECT totals.*,opening.*,coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'balance',balance) ORDER BY date ${sql.raw(direction)},id ${sql.raw(direction)}) FROM selected),'[]'::jsonb) AS selected FROM totals CROSS JOIN opening
 `);
 const summary:LedgerHistorySummary={opening:result.opening,totalDebit:result.totalDebit,totalCredit:result.totalCredit,closing:Math.round((result.opening+result.totalDebit-result.totalCredit)*100)/100};
 const info:HistoryInfo={page:result.page,pageSize:HISTORY_PAGE_SIZE,total:result.total,query:search,sort:'date',direction,all:!!request.all};
 return {...result,ids:result.selected.map(row=>row.id),balances:new Map(result.selected.map(row=>[row.id,row.balance])),summary,info};
}
