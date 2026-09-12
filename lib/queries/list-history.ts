import "server-only";
import {sql,type SQL,type SQLWrapper} from "drizzle-orm";
import {db} from "@/lib/db";
import {parseTableSearch} from "@/lib/search-query";
import {HISTORY_PAGE_SIZE,type HistoryInfo,type HistoryRequest} from "@/lib/history-window";

export const historyColumn=(name:string)=>sql`${sql.identifier(name)}`;
export const historyText=(name:string)=>sql`max(${historyColumn(name)}::text)`;
export type ListHistoryConfig={
  fields:Record<string,SQL>;
  group?:SQL;
  memberOrder?:SQL;
  order:SQL;
  aliases?:Record<string,string>;
};

// Positional CTE names preserve the SELECT's flat field names even when joins
// contain several columns named company_id. Only selected IDs cross the wire;
// the original Drizzle query still decodes the selected business records.
export async function listHistoryWindow(query:SQLWrapper, request:HistoryRequest, config:ListHistoryConfig){
  const select=query as SQLWrapper & {getSelectedFields():Record<string,unknown>};
  const names=Object.keys(select.getSelectedFields());
  if(!names.includes('id'))throw new Error('History source needs an id');
  const page=Math.min(1000000,Math.max(1,Math.floor(request.page||1)));
  const search=(request.query??'').slice(0,300),direction=request.direction==='asc'?'asc':'desc';
  const sort=Object.hasOwn(config.fields,request.sort??'')?request.sort!:'';
  const pairs=Object.entries(config.fields).flatMap(([name,value])=>[sql`${name}::text`,value]);
  const predicates=parseTableSearch(search.replaceAll(',',' ')).map(term=>{
    const field=term.field?(config.aliases?.[term.field]??Object.keys(config.fields).find(key=>key.toLowerCase()===term.field)):undefined;
    if(term.field&&!field)return sql`false`;
    const haystack=field?sql`fields->>${field}::text`:sql`(SELECT string_agg(value,' ') FROM jsonb_each_text(fields))`;
    return sql`position(${term.value} in lower(coalesce(${haystack},'')))>0`;
  });
  const order=sort?sql`nullif(fields->${sort}::text,'null'::jsonb) ${sql.raw(direction)} NULLS LAST,id`:sql`ordering,id`;
  const [result]=await db.execute<{ids:string[];total:number;recordTotal:number;page:number}>(sql`
    WITH source(${sql.join(names.map(name=>sql.identifier(name)),sql`,`)}) AS (${query.getSQL()}),
    grouped AS (
      SELECT (${config.group??historyColumn('id')})::text AS id,
        array_agg("id"::text ORDER BY ${config.memberOrder??historyColumn('id')}) AS ids,
        jsonb_build_object(${sql.join(pairs,sql`,`)}) AS fields,
        row_number() OVER(ORDER BY ${config.order},(${config.group??historyColumn('id')})::text) AS ordering
      FROM source GROUP BY ${config.group??historyColumn('id')}
    ), matched AS (SELECT * FROM grouped WHERE ${predicates.length?sql.join(predicates,sql` AND `):sql`true`}),
    totals AS (SELECT count(*)::int AS total,coalesce(sum(cardinality(ids)),0)::int AS "recordTotal",
      least(${page},greatest(1,ceil(count(*)::numeric/${HISTORY_PAGE_SIZE})))::int AS page FROM matched),
    selected AS (SELECT *,row_number() OVER(ORDER BY ${order}) AS position FROM matched ORDER BY ${order}
      ${request.all?sql``:sql`LIMIT ${HISTORY_PAGE_SIZE} OFFSET (SELECT (page-1)*${HISTORY_PAGE_SIZE} FROM totals)`})
    SELECT totals.*,coalesce((SELECT jsonb_agg(member.id ORDER BY selected.position,member.position)
      FROM selected CROSS JOIN LATERAL unnest(selected.ids) WITH ORDINALITY member(id,position)),'[]'::jsonb) AS ids FROM totals
  `);
  return {...result,info:{page:result.page,pageSize:HISTORY_PAGE_SIZE,total:result.total,recordTotal:result.recordTotal,query:search,sort,direction,all:!!request.all} satisfies HistoryInfo};
}

export function orderHistoryRecords<T extends {id:string}>(rows:T[],ids:string[]){
  const byId=new Map(rows.map(row=>[row.id,row]));
  return ids.flatMap(id=>{const row=byId.get(id);return row?[row]:[]});
}
