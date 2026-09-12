import 'server-only';
import {and,eq,sql,type SQL} from 'drizzle-orm';
import {db} from '@/lib/db';
import {companies,documents,documentTypes,documentLines,items,locations} from '@/lib/db/schema';
import {listHistoryWindow,historyText as text} from './list-history';
import type {HistoryRequest} from '@/lib/history-window';

export async function stockDocumentHistory(code:'STOCK_TRANSFER'|'STOCK_ADJUSTMENT',scope:SQL|undefined,request:HistoryRequest){
 const source=db.select({id:documents.id,number:documents.number,date:documents.documentDate,createdAt:documents.createdAt,status:documents.status,reason:documents.reason,
  company:sql`coalesce(${companies.shortName},${companies.name})`,
  from:sql`(array_agg(coalesce(${locations.name},'Unassigned') ORDER BY ${documentLines.lineNo}) FILTER(WHERE ${documentLines.stockMovement}=-1))[1]`,
  to:sql`(array_agg(coalesce(${locations.name},'Unassigned') ORDER BY ${documentLines.lineNo}) FILTER(WHERE ${documentLines.stockMovement}=1))[1]`,
  location:sql`(array_agg(coalesce(${locations.name},'Unassigned') ORDER BY ${documentLines.lineNo}) FILTER(WHERE ${documentLines.id} IS NOT NULL))[1]`,
  items:sql`count(${documentLines.id}) FILTER(WHERE ${documentLines.stockMovement}=-1)`,
  net:sql`coalesce(sum(${documentLines.quantity}*${documentLines.stockMovement}),0)`,
  item:sql`string_agg(concat_ws(' ',${items.name},${items.sku}),' ')`,
 }).from(documents).innerJoin(documentTypes,eq(documentTypes.id,documents.documentTypeId)).innerJoin(companies,eq(companies.id,documents.companyId))
 .leftJoin(documentLines,eq(documentLines.documentId,documents.id)).leftJoin(items,eq(items.id,documentLines.itemId)).leftJoin(locations,eq(locations.id,documentLines.locationId))
 .where(and(eq(documentTypes.code,code),scope)).groupBy(documents.id,companies.id);
 return listHistoryWindow(source,request,{order:sql`max("date") DESC,max("createdAt") DESC`,fields:{
  number:text('number'),date:sql`max("date")`,_date:sql`to_char(max("date"),'DD-MM-YYYY')`,company:text('company'),status:text('status'),reason:text('reason'),from:text('from'),to:text('to'),location:text('location'),items:sql`max("items")`,net:sql`max("net")`,item:text('item'),
 },aliases:{product:'item'}});
}
