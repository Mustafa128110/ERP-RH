import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {sql} from "drizzle-orm";
import {db} from "@/lib/db";
import {items,units,documents,documentLines,inventoryTransactions,documentTypes,settings} from "@/lib/db/schema";
import {postStockConversion} from "./stock-conversion";
import {fifoValuations} from "./stock-cost";
import {queryItemOptions} from "./item-options";
import {queryProductRates} from "./products";
import {commandContext} from "@/lib/db/command-context";
async function main(){const rollback=new Error("rollback conversion fixtures");try{await db.transaction(async tx=>{
 const [company]=await tx.execute<{id:string}>(sql`SELECT id FROM companies LIMIT 1`),[user]=await tx.execute<{id:string}>(sql`SELECT id FROM users LIMIT 1`),[location]=await tx.execute<{id:string}>(sql`SELECT id FROM locations LIMIT 1`);
 const token=randomUUID(),sackUnit=randomUUID(),packetUnit=randomUUID(),sack=randomUUID();
 await tx.insert(units).values([{id:sackUnit,name:`QA sacks ${token}`,symbol:`S${token.slice(0,6)}`},{id:packetUnit,name:`QA packets ${token}`,symbol:`P${token.slice(0,6)}`}]);
 await tx.insert(items).values({id:sack,companyId:company.id,name:`QA nails sack ${token}`,sku:`QA-${token}`,baseUnitId:sackUnit});
 const [purchaseType]=await tx.execute<{id:number}>(sql`SELECT id FROM document_types WHERE company_id=${company.id}::uuid AND code='PURCHASE_INVOICE' LIMIT 1`);
 const [conversionType]=await tx.insert(documentTypes).values({companyId:company.id,code:"STOCK_CONVERSION",name:"QA Stock Conversion",series:"CV",affectsInventory:true}).onConflictDoUpdate({target:[documentTypes.companyId,documentTypes.code],set:{code:sql`excluded.code`}}).returning();
 const p1=randomUUID(),p2=randomUUID(),l1=randomUUID(),l2=randomUUID();
 await tx.insert(documents).values([{id:p1,companyId:company.id,documentTypeId:purchaseType.id,number:`QA-A-${token}`,documentDate:"2020-01-01",status:"posted"},{id:p2,companyId:company.id,documentTypeId:purchaseType.id,number:`QA-B-${token}`,documentDate:"2021-01-01",status:"posted"}]);
 await tx.insert(documentLines).values([{id:l1,companyId:company.id,documentId:p1,lineNo:1,itemId:sack,unitId:sackUnit,locationId:location.id,quantity:"1",baseQuantity:"1",unitCost:"100"},{id:l2,companyId:company.id,documentId:p2,lineNo:1,itemId:sack,unitId:sackUnit,locationId:location.id,quantity:"2",baseQuantity:"2",unitCost:"200"}]);
 await tx.insert(inventoryTransactions).values([{companyId:company.id,documentLineId:l1,movement:1,quantity:"1",baseQuantity:"1",unitCost:"100",totalCost:"100"},{companyId:company.id,documentLineId:l2,movement:1,quantity:"2",baseQuantity:"2",unitCost:"200",totalCost:"400"}]);
 const shared={companyId:company.id,channelId:"counter",locationId:location.id,documentDate:"2026-11-22",note:"QA conversion",userId:user.id,documentTypeId:conversionType.id,series:conversionType.series};
 const first=await postStockConversion(tx,{...shared,operationId:randomUUID(),inputs:[{itemId:sack,unitId:sackUnit,quantity:1}],outputs:[{itemId:"",newName:`QA nail packets ${token}`,unitId:packetUnit,quantity:50,salesRate:5,costShare:100}]});
 assert.equal(first.totalCost,100,"conversion takes the next FIFO layer, not the weighted average");const packet=first.productsCreated[0].id;
 const quantities=await tx.execute<{id:string;quantity:number}>(sql`SELECT dl.item_id AS id,sum(it.movement*it.base_quantity)::float8 AS quantity FROM inventory_transactions it JOIN document_lines dl ON dl.id=it.document_line_id WHERE dl.item_id IN (${sack}::uuid,${packet}::uuid) GROUP BY dl.item_id ORDER BY dl.item_id`);
 assert.deepEqual(new Map(quantities.map(row=>[row.id,row.quantity])),new Map([[sack,2],[packet,50]]));
 const partialRollback=new Error("rollback partial shortage");
 try{await tx.transaction(async nested=>{const partial=await postStockConversion(nested,{...shared,operationId:randomUUID(),inputs:[{itemId:sack,unitId:sackUnit,quantity:3}],outputs:[{itemId:packet,unitId:packetUnit,quantity:150,salesRate:5,costShare:100}]});assert.equal(partial.totalCost,566.67,"existing FIFO layers and only the shortage use their respective recorded costs");throw partialRollback;});}catch(error){if(error!==partialRollback)throw error;}

 await commandContext.run({database:tx,afterCommit:[]},async()=>{
  assert.deepEqual(await fifoValuations([{itemId:sack,locationId:location.id},{itemId:packet,locationId:location.id}]),[400,100],"total physical stock value remains 500");
  const option=(await queryItemOptions(sql`items.id=${packet}::uuid`))[0];assert.equal(Number(option.salesRate),5);assert.equal(Number(option.rate),2);
  const product=(await queryProductRates([company.id])).find(product=>product.id===packet)!;assert.equal(Number(product.salesRate),5);assert.equal(Number(product.purchaseRate1),2);
 });
 const second=await postStockConversion(tx,{...shared,operationId:randomUUID(),inputs:[{itemId:sack,unitId:sackUnit,quantity:1}],outputs:[{itemId:packet,unitId:packetUnit,quantity:30,salesRate:6,costShare:60},{itemId:"",newName:`QA nail boxes ${token}`,unitId:packetUnit,quantity:20,salesRate:8,costShare:40}]});
 assert.equal(second.totalCost,200);const box=second.productsCreated[0].id;
 await commandContext.run({database:tx,afterCommit:[]},async()=>assert.deepEqual(await fifoValuations([{itemId:sack,locationId:location.id},{itemId:packet,locationId:location.id},{itemId:box,locationId:location.id}]),[200,220,80]));
 const third=await postStockConversion(tx,{...shared,operationId:randomUUID(),inputs:[{itemId:sack,unitId:sackUnit,quantity:1},{itemId:packet,unitId:packetUnit,quantity:10}],outputs:[{itemId:"",newName:`QA nail kits ${token}`,unitId:packetUnit,quantity:10,salesRate:30,costShare:100}]});
 assert.equal(third.totalCost,220,"multiple inputs retain their own FIFO cost before allocation");
 await commandContext.run({database:tx,afterCommit:[]},async()=>assert.deepEqual(await fifoValuations([{itemId:sack,locationId:location.id},{itemId:packet,locationId:location.id},{itemId:box,locationId:location.id},{itemId:third.productsCreated[0].id,locationId:location.id}]),[0,200,80,220]));
 const negative=await postStockConversion(tx,{...shared,operationId:randomUUID(),inputs:[{itemId:sack,unitId:sackUnit,quantity:1}],outputs:[{itemId:packet,unitId:packetUnit,quantity:50,salesRate:5,costShare:100}]});
 assert.equal(negative.totalCost,166.67,"a shortage uses the actual recorded average incoming cost");
 const deeper=await postStockConversion(tx,{...shared,operationId:randomUUID(),inputs:[{itemId:sack,unitId:sackUnit,quantity:1}],outputs:[{itemId:packet,unitId:packetUnit,quantity:50,salesRate:5,costShare:100}]});
 assert.equal(deeper.totalCost,166.67,"already negative stock can still convert using recorded cost");
 const [balance]=await tx.execute<{quantity:string}>(sql`SELECT sum(it.movement*it.base_quantity)::text AS quantity FROM inventory_transactions it JOIN document_lines dl ON dl.id=it.document_line_id WHERE dl.item_id=${sack}::uuid`);assert.equal(Number(balance.quantity),-2);
 const [before]=await tx.execute(sql`SELECT (SELECT count(*)::int FROM items) AS items,(SELECT count(*)::int FROM documents) AS documents,(SELECT count(*)::int FROM inventory_transactions) AS movements`);
 await assert.rejects(()=>tx.transaction(nested=>postStockConversion(nested,{...shared,operationId:randomUUID(),inputs:[{itemId:sack,unitId:sackUnit,quantity:1}],outputs:[{itemId:"",newName:"Must not survive",unitId:randomUUID(),quantity:50,salesRate:5,costShare:100}]})));
 assert.deepEqual((await tx.execute(sql`SELECT (SELECT count(*)::int FROM items) AS items,(SELECT count(*)::int FROM documents) AS documents,(SELECT count(*)::int FROM inventory_transactions) AS movements`))[0],before,"an invalid output unit rolls back every new record");
 await tx.insert(settings).values({companyId:company.id,key:`product_rates:${packet}`,value:JSON.stringify({rate1:"12.34",rate2:"11.11",rate3:"10.01",salesRate:"15.99"})});
 await commandContext.run({database:tx,afterCommit:[]},async()=>{const option=(await queryItemOptions(sql`items.id=${packet}::uuid`))[0];assert.equal(Number(option.rate),12.34);assert.equal(Number(option.salesRate),15.99);const product=(await queryProductRates([company.id])).find(product=>product.id===packet)!;assert.equal(Number(product.purchaseRate1),12.34);assert.equal(Number(product.purchaseRate2),11.11);assert.equal(Number(product.purchaseRate3),10.01);assert.equal(Number(product.salesRate),15.99);});
 throw rollback;
 });}catch(error){if(error!==rollback)throw error;}console.log("stock conversion FIFO, new-item rates, multi-input/output conservation and rollback checks passed (rolled back)");}
main().finally(()=>db.$client.end()).catch(error=>{console.error(error);process.exitCode=1;});
