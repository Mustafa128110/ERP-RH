"use server";
import {sql} from "drizzle-orm";
import {revalidatePath} from "next/cache";
import {db} from "@/lib/db";
import {getLiveSession,getSession} from "@/lib/auth/session";
import {requirePermission,requireAnyPermission} from "@/lib/auth/permissions";
import {companyInPermissionScope} from "@/lib/auth/scope";
import {documents} from "@/lib/db/schema";
import {resolveChannel,channelInScope} from "@/lib/queries/channels";
import {postStockConversion} from "@/lib/queries/stock-conversion";
import {type ConversionInput,type ConversionOutput,validateConversion} from "@/lib/stock-conversion";
import {OperationError} from "@/lib/operation-errors";
import {guard,DUPLICATE,type ActionResult} from "@/lib/actions/guard";
import {recordAudit} from "@/lib/actions/audit";
import {ensureDocumentType} from "@/lib/actions/document-numbering";
import {CACHE,invalidateLookups,invalidateReads,READ_DOMAIN,getStockFormOptions} from "@/lib/queries/lookups";

export async function listStockConversions(){
 const session=await getSession();requireAnyPermission(session,["stock","stock_adjustments"],"view");
 const scope=await companyInPermissionScope(documents.companyId,session,session.globalPermissions.has("stock.view")||[...session.permissionsByCompany.values()].some(set=>set.has("stock.view"))?"stock":"stock_adjustments");
 const channel=await channelInScope(documents.saleType);
 return [...await db.execute<{id:string;number:string;date:string;channel:string;location:string;inputs:string;outputs:string;cost:string;note:string|null}>(sql`
 SELECT documents.id,documents.number,documents.document_date::text AS date,sc.name AS channel,coalesce(locations.name,'Unassigned') AS location,
  string_agg(items.name||' × '||dl.quantity::text,', ' ORDER BY dl.line_no) FILTER(WHERE it.movement=-1) AS inputs,
  string_agg(items.name||' × '||dl.quantity::text,', ' ORDER BY dl.line_no) FILTER(WHERE it.movement=1) AS outputs,
  coalesce(sum(it.total_cost) FILTER(WHERE it.movement=1),0)::text AS cost,documents.reason AS note
 FROM documents JOIN document_types dt ON dt.id=documents.document_type_id JOIN sales_channels sc ON sc.id=documents.sale_type
 JOIN document_lines dl ON dl.document_id=documents.id JOIN items ON items.id=dl.item_id JOIN inventory_transactions it ON it.document_line_id=dl.id
 LEFT JOIN locations ON locations.id=dl.location_id
 WHERE dt.code::text='STOCK_CONVERSION' AND documents.status='posted' AND ${scope??sql`false`} AND ${channel??sql`true`}
 GROUP BY documents.id,sc.name,locations.name ORDER BY documents.document_date DESC,documents.created_at DESC`)];
}
export async function getConversionOptions(){return getStockFormOptions();}
export async function createStockConversion(input:{companyId:string;channelId:string;locationId:string|null;documentDate:string;note?:string;inputs:ConversionInput[];outputs:ConversionOutput[];operationId:string}):Promise<ActionResult&{id?:string;number?:string}>{
 return guard("Couldn't post the stock conversion.",async()=>{
  const session=await getLiveSession();requirePermission(session,"stock_adjustments","create",{companyId:input.companyId,warehouseId:input.locationId??undefined});
  if(session.warehouseIds.length&&!input.locationId)return {error:"Choose a warehouse assigned to your role."};
  if(!/^\d{4}-\d{2}-\d{2}$/.test(input.documentDate))return {error:"Choose a valid conversion date."};
  try{validateConversion(input.inputs,input.outputs);}catch(error){if(error instanceof OperationError)return {error:error.message};throw error;}
  if(input.outputs.some(row=>!row.itemId))requirePermission(session,"products","create",{companyId:input.companyId});
  const channelId=await resolveChannel(input.channelId);
  const type=await ensureDocumentType({companyId:input.companyId,code:"STOCK_CONVERSION",name:"Stock Conversion",series:"CV",affectsInventory:true,active:true});
  const result=await db.transaction(tx=>postStockConversion(tx,{...input,channelId,note:input.note?.trim()??"",userId:session.userId,documentTypeId:type.id,series:type.series}));
  await invalidateLookups(CACHE.items,CACHE.documentTypes);await invalidateReads(READ_DOMAIN.products,READ_DOMAIN.stock,READ_DOMAIN.sales,READ_DOMAIN.purchases);
  revalidatePath("/inventory/stock");revalidatePath("/sales");
  await recordAudit({action:"create",entity:"stock conversion",entityId:result.id,companyId:input.companyId,summary:result.number,detail:JSON.stringify({inputLines:input.inputs.length,outputLines:input.outputs.length,recordedCost:result.totalCost,productsCreated:result.productsCreated})});
  return {success:true,id:result.id,number:result.number};
 },{[DUPLICATE]:"A conversion number or product SKU is already in use. Please retry."});
}
