import "server-only";
import {randomUUID} from "node:crypto";
import {and,eq,inArray,sql} from "drizzle-orm";
import {db} from "@/lib/db";
import {items,documentLines,inventoryTransactions,documents,documentNumberLedger,documentTypes} from "@/lib/db/schema";
import {resolveBaseQuantities,MissingUnitConversionError} from "@/lib/queries/unit-conversion";
import {nextDocumentNumber} from "@/lib/db/document-numbers";
import {nextSequenceRange,SKU_SCOPE,formatSku} from "@/lib/db/sequences";
import {claimOperation,DuplicateOperationError} from "@/lib/actions/operation-id";
import {conversionCostShares,validateConversion,conversionLines,type ConversionInput,type ConversionOutput} from "@/lib/stock-conversion";
import {OperationError} from "@/lib/operation-errors";
import {toTitleCase} from "@/lib/format";
type Tx=Parameters<Parameters<typeof db.transaction>[0]>[0];

async function inputCosts(tx:Tx,locationId:string|null,requests:{itemId:string;quantity:number}[]){
 const values=sql.join(requests.map((row,index)=>sql`(${index}::int,${row.itemId}::uuid,${row.quantity}::numeric)`),sql`, `);
 return [...await tx.execute<{position:number;available:string;cost:string;totalCost:string}>(sql`
 WITH requested(position,item_id,quantity) AS (VALUES ${values}),
 balances AS (SELECT r.position,coalesce(sum(it.movement*it.base_quantity),0) AS available,
  coalesce(sum(it.base_quantity) FILTER(WHERE it.movement=-1),0) AS issued
  FROM requested r LEFT JOIN document_lines dl ON dl.item_id=r.item_id AND dl.location_id IS NOT DISTINCT FROM ${locationId}::uuid
  LEFT JOIN inventory_transactions it ON it.document_line_id=dl.id GROUP BY r.position),
 incoming AS (SELECT r.position,coalesce(
  sum(it.total_cost) FILTER(WHERE dl.location_id IS NOT DISTINCT FROM ${locationId}::uuid)/nullif(sum(it.base_quantity) FILTER(WHERE dl.location_id IS NOT DISTINCT FROM ${locationId}::uuid),0),
  sum(it.total_cost)/nullif(sum(it.base_quantity),0),0) AS average_cost
  FROM requested r LEFT JOIN document_lines dl ON dl.item_id=r.item_id
  LEFT JOIN inventory_transactions it ON it.document_line_id=dl.id AND it.movement=1 AND it.total_cost IS NOT NULL GROUP BY r.position),
 layers AS (SELECT r.position,it.base_quantity AS quantity,coalesce(it.total_cost/nullif(it.base_quantity,0),0) AS cost,
  coalesce(sum(it.base_quantity) OVER(PARTITION BY r.position ORDER BY d.document_date,it.created_at,it.id ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING),0) AS start
  FROM requested r JOIN document_lines dl ON dl.item_id=r.item_id AND dl.location_id IS NOT DISTINCT FROM ${locationId}::uuid
  JOIN inventory_transactions it ON it.document_line_id=dl.id AND it.movement=1 JOIN documents d ON d.id=dl.document_id),
 priced AS (SELECT r.position,b.available,round(coalesce(sum((greatest(0,l.quantity-greatest(0,b.issued-l.start))-greatest(0,l.quantity-greatest(0,b.issued+r.quantity-l.start)))*l.cost),0)+greatest(0,r.quantity-greatest(0,b.available))*a.average_cost,2) AS cost
  FROM requested r JOIN balances b ON b.position=r.position JOIN incoming a ON a.position=r.position LEFT JOIN layers l ON l.position=r.position GROUP BY r.position,b.available,r.quantity,a.average_cost)
 SELECT position,available::text,cost::text,sum(cost) OVER()::text AS "totalCost" FROM priced ORDER BY position`)];
}
export type ConversionPost={companyId:string;channelId:string;locationId:string|null;documentDate:string;note:string;inputs:ConversionInput[];outputs:ConversionOutput[];operationId:string;userId:string;documentTypeId:typeof documentTypes.$inferSelect.id;series:typeof documentTypes.$inferSelect.series};
export async function postStockConversion(tx:Tx,input:ConversionPost){
 input={...input,...conversionLines(input.inputs,input.outputs)};
 validateConversion(input.inputs,input.outputs);
 if(!await claimOperation(tx,input.operationId))throw new DuplicateOperationError();
 const existingIds=[...new Set([...input.inputs,...input.outputs].map(row=>row.itemId).filter(Boolean))];
 const existing=await tx.select({id:items.id,baseUnitId:items.baseUnitId,isActive:items.isActive}).from(items).where(and(eq(items.companyId,input.companyId),inArray(items.id,existingIds))).orderBy(items.id).for("update");
 if(existing.length!==existingIds.length||existing.some(item=>!item.isActive))throw new OperationError("Choose active products belonging to Royal Hardware.");
 if(existing.some(item=>!item.baseUnitId))throw new OperationError("Set a base stock unit for every existing input and output product before converting it.");
 let inputQuantities:number[];
 try{inputQuantities=(await resolveBaseQuantities(tx,input.inputs.map(row=>({itemId:row.itemId,unitId:row.unitId,quantity:row.quantity})))).map(quantity=>Math.round(quantity*1000)/1000);}catch(error){if(error instanceof MissingUnitConversionError)throw new OperationError(error.message);throw error;}
 if(inputQuantities.some(quantity=>quantity<=0))throw new OperationError("Input quantities must be at least 0.001 base units.");
 const priced=await inputCosts(tx,input.locationId,input.inputs.map((row,index)=>({itemId:row.itemId,quantity:inputQuantities[index]})));
 const fresh=input.outputs.map((row,index)=>({row,index})).filter(({row})=>!row.itemId);
 const numbers=await nextSequenceRange(SKU_SCOPE,fresh.length,tx);
 const newProducts=fresh.map(({row,index},position)=>({id:randomUUID(),companyId:input.companyId,name:toTitleCase(row.newName)!,sku:formatSku(numbers[position]),baseUnitId:row.unitId,index}));
 if(newProducts.length)await tx.insert(items).values(newProducts.map(({index,...product})=>{void index;return product;}));
 const newByIndex=new Map(newProducts.map(product=>[product.index,product.id]));
 const outputs=input.outputs.map((row,index)=>({...row,itemId:row.itemId||newByIndex.get(index)!}));
 let outputQuantities:number[];
 try{outputQuantities=(await resolveBaseQuantities(tx,outputs.map(row=>({itemId:row.itemId,unitId:row.unitId,quantity:row.quantity})))).map(quantity=>Math.round(quantity*1000)/1000);}catch(error){if(error instanceof MissingUnitConversionError)throw new OperationError(error.message);throw error;}
 if(outputQuantities.some(quantity=>quantity<=0))throw new OperationError("Output quantities must be at least 0.001 base units.");
 const totalCost=Number(priced[0].totalCost),costs=conversionCostShares(totalCost,outputs.map(row=>row.costShare));
 const number=await nextDocumentNumber(input.series,tx),documentId=randomUUID();
 await tx.insert(documents).values({id:documentId,companyId:input.companyId,saleType:input.channelId,documentTypeId:input.documentTypeId,number,status:"posted",documentDate:input.documentDate,reason:input.note||"Stock conversion",createdAt:sql`clock_timestamp()`,createdBy:input.userId});
 await tx.insert(documentNumberLedger).values({companyId:input.companyId,documentTypeId:input.documentTypeId,number,documentId});
 const lines=[...input.inputs.map((row,index)=>({id:randomUUID(),itemId:row.itemId,unitId:row.unitId,quantity:row.quantity,baseQuantity:inputQuantities[index],cost:Number(priced[index].cost),movement:-1 as const,salesRate:0})),...outputs.map((row,index)=>({id:randomUUID(),itemId:row.itemId,unitId:row.unitId,quantity:row.quantity,baseQuantity:outputQuantities[index],cost:costs[index],movement:1 as const,salesRate:row.salesRate}))];
 await tx.insert(documentLines).values(lines.map((row,index)=>({id:row.id,companyId:input.companyId,documentId,lineNo:index+1,itemId:row.itemId,unitId:row.unitId,locationId:input.locationId,quantity:String(row.quantity),baseQuantity:String(row.baseQuantity),unitPrice:String(row.salesRate),unitCost:String(row.cost/row.quantity),lineTotal:"0",stockMovement:row.movement})));
 await tx.insert(inventoryTransactions).values(lines.map(row=>({companyId:input.companyId,documentLineId:row.id,movement:row.movement,quantity:String(row.quantity),baseQuantity:String(row.baseQuantity),unitCost:String(row.cost/row.baseQuantity),totalCost:row.cost.toFixed(2),createdAt:sql`clock_timestamp()`})));
 return {id:documentId,number,totalCost,productsCreated:newProducts.map(({id,name,sku})=>({id,name,sku}))};
}
