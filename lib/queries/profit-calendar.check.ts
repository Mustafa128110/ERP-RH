import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {sql} from "drizzle-orm";
import {db} from "@/lib/db";
import {commandContext} from "@/lib/db/command-context";
import {documents,documentLines,inventoryTransactions,ledgerEntries,salesChannels,expenses,items,documentTypes} from "@/lib/db/schema";
import {queryProfitCalendar} from "./profit-calendar";
async function main(){const rollback=new Error("rollback profit fixtures");try{await db.transaction(async tx=>{
 const [company]=await tx.execute<{id:string}>(sql`SELECT id FROM companies LIMIT 1`),[category]=await tx.execute<{id:string}>(sql`SELECT id FROM expense_categories WHERE company_id=${company.id}::uuid LIMIT 1`);
 const token=randomUUID(),channel=`qa-profit-${token}`,item=randomUUID();
 await tx.insert(salesChannels).values({id:channel,name:`QA profit ${token}`});await tx.insert(items).values({id:item,companyId:company.id,name:`QA profit item ${token}`,sku:`QA-P-${token}`});
 await tx.insert(documentTypes).values([{companyId:company.id,code:"LEDGER_CLOSING",name:"Ledger Closing",series:"LC",affectsAccounting:true},{companyId:company.id,code:"SALES_RETURN",name:"Sales Return",series:"SR",affectsAccounting:true,affectsInventory:true}]).onConflictDoUpdate({target:[documentTypes.companyId,documentTypes.code],set:{code:sql`excluded.code`}});
 const types=await tx.select().from(documentTypes),type=(code:string)=>types.find(type=>type.companyId===company.id&&type.code===code)!;
 const closing=type("LEDGER_CLOSING");
 const sale=randomUUID(),inclusive=randomUUID(),returned=randomUUID(),nextMonth=randomUUID(),cancelled=randomUUID(),writeoff=randomUUID();
 await tx.insert(documents).values([
  {id:sale,companyId:company.id,saleType:channel,documentTypeId:type("SALES_INVOICE").id,number:`QA-A-${token}`,documentDate:"2024-01-10",status:"posted",subtotal:"200",discountTotal:"20",shippingTotal:"10",taxTotal:"18",grandTotal:"208"},
  {id:inclusive,companyId:company.id,saleType:channel,documentTypeId:type("SALES_INVOICE").id,number:`QA-I-${token}`,documentDate:"2024-01-11",status:"posted",subtotal:"118",taxTotal:"18",taxInclusive:true,grandTotal:"118"},
  {id:returned,companyId:company.id,saleType:channel,documentTypeId:type("SALES_RETURN").id,number:`QA-R-${token}`,documentDate:"2024-01-12",status:"posted",subtotal:"100",discountTotal:"10",taxTotal:"9",grandTotal:"99",sourceDocumentId:sale},
  {id:nextMonth,companyId:company.id,saleType:channel,documentTypeId:type("SALES_INVOICE").id,number:`QA-F-${token}`,documentDate:"2024-02-01",status:"posted",subtotal:"120",grandTotal:"120"},
  {id:cancelled,companyId:company.id,saleType:channel,documentTypeId:type("SALES_INVOICE").id,number:`QA-X-${token}`,documentDate:"2024-01-14",status:"cancelled",subtotal:"999",grandTotal:"999"},
  {id:writeoff,companyId:company.id,saleType:channel,documentTypeId:closing.id,number:`QA-C-${token}`,documentDate:"2024-01-13",status:"posted",subtotal:"15",grandTotal:"15"},
 ]);
 const lines=[{id:randomUUID(),documentId:sale,cost:60},{id:randomUUID(),documentId:inclusive,cost:40},{id:randomUUID(),documentId:returned,cost:30},{id:randomUUID(),documentId:nextMonth,cost:20},{id:randomUUID(),documentId:cancelled,cost:500}];
 await tx.insert(documentLines).values(lines.map(line=>({id:line.id,companyId:company.id,documentId:line.documentId,lineNo:1,itemId:item,quantity:"1",baseQuantity:"1",unitCost:"999",lineTotal:"999"})));
 await tx.insert(inventoryTransactions).values(lines.map(line=>({companyId:company.id,documentLineId:line.id,movement:line.documentId===returned?1:-1,quantity:"1",baseQuantity:"1",unitCost:String(line.cost),totalCost:String(line.cost)})));
 await tx.insert(ledgerEntries).values({companyId:company.id,documentId:writeoff,credit:"15"});
 await tx.insert(expenses).values([{companyId:company.id,saleType:channel,expenseCategoryId:category.id,amount:"20",expenseDate:"2024-01-12"},{companyId:company.id,saleType:channel,expenseCategoryId:category.id,amount:"5",expenseDate:"2024-02-02"}]);
 await commandContext.run({database:tx,afterCommit:[]},async()=>{
  const january=await queryProfitCalendar(sql`${company.id}::uuid`,channel,"2024-01");
  assert.deepEqual(january.months.map(month=>month.period),["2024-02","2024-01"],"all older activity months are available without a current-month default");
  const month=january.months.find(month=>month.period==="2024-01")!;
  assert.equal(Number(month.revenue),200);assert.equal(Number(month.cost),70);assert.equal(Number(month.grossProfit),130);assert.equal(Number(month.expenses),20);assert.equal(Number(month.adjustments),-15);assert.equal(Number(month.netProfit),95);
  assert.equal(january.days.length,31);assert.equal(Number(january.days.find(day=>day.period==="2024-01-10")!.netProfit),130);
  assert.equal(Number(january.days.find(day=>day.period==="2024-01-12")!.netProfit),-80,"returns reverse their recorded cost and expenses stay on their own date");
  assert.equal(Number(january.days.find(day=>day.period==="2024-01-14")!.netProfit),0,"cancelled sales are excluded; a day without activity is zero");
  const february=await queryProfitCalendar(sql`${company.id}::uuid`,channel,"2024-02");assert.equal(february.days.length,29,"leap-year calendar is complete");assert.equal(Number(february.months[0].netProfit),95);
 });throw rollback;
 });}catch(error){if(error!==rollback)throw error;}console.log("historical monthly/daily profit, recorded cost, returns, tax, expenses, closings and leap-year checks passed (rolled back)");}
main().finally(()=>db.$client.end()).catch(error=>{console.error(error);process.exitCode=1;});
