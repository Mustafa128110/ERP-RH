import "server-only";
import {sql,type SQL} from "drizzle-orm";
import {db} from "@/lib/db";
import {parseTableSearch} from "@/lib/search-query";
import {HISTORY_PAGE_SIZE,type HistoryRequest,type HistoryInfo} from "@/lib/history-window";

// The filtered relation is resolved before its page. Searching and sorting do
// not operate on an arbitrary first hundred records. Only selected IDs and
// aggregate metadata cross the database connection.
export async function documentHistoryWindow(scope: SQL | undefined, code: "SALES_INVOICE"|"PURCHASE_INVOICE", request: HistoryRequest) {
  const requestedPage=Math.min(1000000,Math.max(1,Math.floor(request.page||1)));
  const query=(request.query??"").slice(0,300);
  const direction=request.direction==="asc"?"asc":"desc";
  const sorts:Record<string,SQL>={number:sql`number`,date:sql`document_date`,customer:sql`party`,supplier:sql`party`,company:sql`company`,total:sql`grand_total`,paid:sql`paid_amount`,balance:sql`balance`,status:sql`display_status`,age:sql`current_date-document_date`,saleType:sql`sale_type`};
  const sort=Object.hasOwn(sorts,request.sort??"")?request.sort!:"";
  const terms=parseTableSearch(query.replaceAll(","," "));
  const fields:Record<string,string>={item:"item",product:"item",unit:"unit",contact:"contact",customer:"contact",supplier:"contact",number:"number",company:"company",total:"total",paid:"paid",balance:"balance",status:"status",date:"date",saletype:"saleType"};
  const matches=terms.map(term=>{
    const field=term.field?fields[term.field]:null;
    if(term.field&&!field)return sql`false`;
    const text=field?sql`search ->> ${field}`:sql`concat_ws(' ',search->>'number',search->>'company',search->>'contact',search->>'item',search->>'unit',search->>'date',search->>'total',search->>'paid',search->>'balance',search->>'status',search->>'saleType')`;
    return sql`position(${term.value} in lower(coalesce(${text},''))) > 0`;
  });
  const order=sort?sql`${sorts[sort]} ${sql.raw(direction)} NULLS LAST, id`:code==="SALES_INVOICE"?sql`(balance>0) DESC, CASE WHEN balance>0 THEN document_date END ASC, document_date DESC, id`:sql`document_date DESC,created_at DESC,id`;
  const [result]=await db.execute<{ids:string[];total:number;outstanding:string;page:number}>(sql`
    WITH source AS (
      SELECT documents.id,documents.number,documents.document_date,documents.created_at,documents.grand_total,documents.paid_amount,documents.sale_type,
        CASE WHEN documents.status='cancelled' THEN 0 ELSE greatest(documents.grand_total-documents.paid_amount,0) END AS balance,
        coalesce(contacts.display_name,'') AS party,coalesce(companies.short_name,companies.name) AS company,
        CASE WHEN documents.status='cancelled' THEN 'Cancelled' WHEN documents.is_paid THEN 'Paid' WHEN documents.paid_amount>0 THEN 'Partial' ELSE 'Unpaid' END AS display_status,
        ${query?sql`(SELECT jsonb_build_object('item',string_agg(coalesce(items.name,''),' '),'unit',string_agg(concat_ws(' ',units.name,units.symbol),' ')) FROM document_lines LEFT JOIN items ON items.id=document_lines.item_id LEFT JOIN units ON units.id=document_lines.unit_id WHERE document_lines.document_id=documents.id)`:sql`'{}'::jsonb`} AS line_search
      FROM documents JOIN document_types ON document_types.id=documents.document_type_id JOIN companies ON companies.id=documents.company_id LEFT JOIN contacts ON contacts.id=documents.contact_id
      WHERE document_types.code=${code} AND ${scope??sql`true`}
    ), searchable AS (
      SELECT *,coalesce(line_search,'{}'::jsonb)||jsonb_build_object('number',number,'company',company,'contact',party,'date',to_char(document_date,'DD-MM-YYYY'),'total',grand_total::text,'paid',paid_amount::text,'balance',balance::text,'status',display_status,'saleType',CASE WHEN sale_type='counter' THEN 'Counter Sales' ELSE sale_type::text END) AS search FROM source
    ), matched AS (SELECT * FROM searchable WHERE ${matches.length?sql.join(matches,sql` AND `):sql`true`}),
    totals AS (SELECT count(*)::int AS total,coalesce(sum(balance),0)::text AS outstanding,
      least(${requestedPage},greatest(1,ceil(count(*)::numeric/${HISTORY_PAGE_SIZE})))::int AS page FROM matched),
    selected AS (SELECT id FROM matched ORDER BY ${order} ${request.all?sql``:sql`LIMIT ${HISTORY_PAGE_SIZE} OFFSET (SELECT (page-1)*${HISTORY_PAGE_SIZE} FROM totals)`})
    SELECT coalesce((SELECT jsonb_agg(id) FROM selected),'[]'::jsonb) AS ids,totals.* FROM totals
  `);
  return {...result,info:{page:result.page,pageSize:HISTORY_PAGE_SIZE,total:result.total,query,sort,direction,all:!!request.all} satisfies HistoryInfo};
}
