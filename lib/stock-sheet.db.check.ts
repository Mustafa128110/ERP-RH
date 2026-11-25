import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {sql} from "drizzle-orm";
import {db} from "./db";
import {commandContext} from "./db/command-context";
import {sessionQuery} from "./db/session-query";
import type {AuthSession} from "./auth/session";
import {runAsWhatsAppUser} from "./whatsapp-agent/context";
import {saveStockSheet} from "./actions/products";
import type {StockSheetRow} from "./stock-sheet";
import {queryProductRates} from "./queries/products";
async function main(){
 const url=new URL(process.env.DATABASE_URL_DIRECT!);assert.equal(url.hostname,"127.0.0.1");assert.match(url.pathname,/^\/restore_\d+$/);
 const [user]=await db.execute<{auth:string}>(sql`SELECT supabase_auth_id AS auth FROM users WHERE status='active' ORDER BY created_at LIMIT 1`),[sessionRow]=await sessionQuery(user.auth);
 const session:AuthSession={userId:sessionRow.id,supabaseAuthId:sessionRow.supabase_auth_id,name:sessionRow.name,email:sessionRow.email,roleNames:sessionRow.role_names,globalPermissions:new Set(sessionRow.perms.filter(p=>p.companyId===null).map(p=>p.key)),permissionsByCompany:new Map(sessionRow.company_ids.map(id=>[id,new Set(sessionRow.perms.filter(p=>p.companyId===id).map(p=>p.key))])),companyIds:sessionRow.company_ids,warehouseIds:sessionRow.warehouse_ids,uiTheme:sessionRow.ui_theme,uiScale:sessionRow.ui_scale};
 const rollback=new Error("rollback stock sheet check");
 try{await db.transaction(async tx=>commandContext.run({database:tx,afterCommit:[]},async()=>runAsWhatsAppUser(session,async()=>{
  const id=randomUUID(),unit=randomUUID(),company=session.companyIds[0],token=randomUUID();
  await tx.execute(sql`INSERT INTO units(id,name,symbol) VALUES(${unit}::uuid,${`Sheet unit ${token}`},${token.slice(0,8)})`);
  const [item]=await tx.execute<{revision:string}>(sql`INSERT INTO items(id,company_id,name,sku,base_unit_id) VALUES(${id}::uuid,${company}::uuid,'Sheet fixture',${`SHEET-${token}`},${unit}::uuid) RETURNING xmin::text AS revision`);
  const row:StockSheetRow={id,_revision:item.revision,companyId:company,name:"Sheet corrected",sku:`SHEET-${token}`,urduName:"",categoryId:"",categoryName:"",brandId:"",brandName:"",unitId:unit,unitName:"",ruleIds:[],taxable:false,isActive:true,supplierId:"",supplierName:"",purchaseQty:"",purchaseRate:"",targetQty:"",rate1:"12.34",rate2:"",rate3:"",salesRate:"23.45",rateChanges:["rate1","salesRate"]};
  const meta={mode:"none" as const,locationId:"",documentDate:"2026-11-25",reason:"Count Correction"};
  const refused=await runAsWhatsAppUser({...session,roleNames:["Salesman"]},()=>saveStockSheet([row],meta));assert.match(refused.error??"",/administrator/);
  assert.match((await saveStockSheet([{...row,_revision:"0"}],meta)).error??"",/changed in another tab/);
  const saved=await saveStockSheet([row],meta);assert.equal(saved.error,undefined,JSON.stringify(saved));
  const product=(await queryProductRates([company])).find(product=>product.id===id)!;assert.equal(product.name,"Sheet corrected");assert.equal(Number(product.purchaseRate1),12.34);assert.equal(Number(product.salesRate),23.45);
  const [audit]=await tx.execute<{count:number}>(sql`SELECT count(*)::int AS count FROM audit_logs WHERE summary='Stock sheet: 1 product(s) saved'`);assert.ok(audit.count>0);
  // A failed stock correction must also roll back the catalogue and prices.
  const failed=await saveStockSheet([{...row,name:"Must roll back",salesRate:"99",targetQty:"10"}],{...meta,mode:"adjust",locationId:randomUUID()});assert.ok(failed.error);
  const [unchanged]=await tx.execute<{name:string;price:string}>(sql`SELECT i.name,s.value::jsonb->>'salesRate' AS price FROM items i JOIN settings s ON s.company_id=i.company_id AND s.key='product_rates:'||i.id::text WHERE i.id=${id}::uuid`);assert.equal(unchanged.name,"Sheet corrected");assert.equal(unchanged.price,"23.45");
  throw rollback;
 })));}catch(error){if(error!==rollback)throw error;}
 console.log("Stock sheet database checks passed: admin authority, mandatory versions, exact prices, audit trail, and atomic refusal rollback (fixtures rolled back)");
}
main().finally(()=>db.$client.end()).catch(error=>{console.error(error);process.exitCode=1;});
