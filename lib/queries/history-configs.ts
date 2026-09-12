import {sql} from 'drizzle-orm';
import {historyColumn as c,historyText as text,type ListHistoryConfig} from './list-history';
const date=(name:string)=>sql`to_char(max(${c(name)}),'DD-MM-YYYY')`;
const method=sql`coalesce(CASE WHEN "bankAccountName" IS NOT NULL THEN 'Account: '||"bankAccountName" WHEN "cashAccountName" IS NOT NULL THEN 'Cash: '||"cashAccountName" WHEN "chequeNumber" IS NOT NULL THEN 'Cheque: '||"chequeNumber" END,'—')`;
const groupedMethod=sql`CASE WHEN count(DISTINCT ${method})=1 THEN max(${method}) ELSE 'Mixed' END`;
export const paymentHistory:ListHistoryConfig={
 group:sql`CASE WHEN "contactId" IS NULL THEN "id"::text ELSE concat_ws('|',"companyId","contactId","documentDate","code") END`,
 memberOrder:sql`"createdAt" DESC,"id"`,order:sql`max("documentDate") DESC,max("createdAt") DESC`,
 fields:{date:sql`max("documentDate")`,_date:date('documentDate'),company:text('company'),contact:text('contact'),
  type:sql`CASE max("code"::text) WHEN 'PURCHASE_INVOICE' THEN 'Made (purchase)' WHEN 'PAYMENT_MADE' THEN 'Made' ELSE 'Received' END`,
  amount:sql`sum("grandTotal"::numeric)*CASE WHEN max("code"::text)='PAYMENT_RECEIVED' THEN 1 ELSE -1 END`,method:groupedMethod,number:sql`string_agg("number",' ')`,_methods:sql`string_agg(${method},' ')`},
 aliases:{customer:'contact',supplier:'contact',total:'amount'},
};
export const expenseHistory:ListHistoryConfig={
 group:sql`concat_ws('|',"companyId","expenseCategoryId","expenseDate","status")`,
 memberOrder:sql`"createdAt" DESC,"id"`,order:sql`max("expenseDate") DESC,max("createdAt") DESC`,
 fields:{date:sql`max("expenseDate")`,_date:date('expenseDate'),company:text('company'),
  category:sql`max("category")||CASE WHEN count(*)>1 THEN ' ('||count(*)::text||')' ELSE '' END`,
  amount:sql`sum("amount"::numeric)`,method:groupedMethod,
  user:sql`CASE WHEN count(DISTINCT coalesce("createdByName",'—'))=1 THEN max(coalesce("createdByName",'—')) ELSE 'Several' END`,
  status:sql`CASE max("status"::text) WHEN 'cancelled' THEN 'Cancelled' ELSE 'Posted' END`,notes:sql`string_agg("notes",' ')`,_methods:sql`string_agg(${method},' ')`},
 aliases:{total:'amount'},
};
export const marketHistory:ListHistoryConfig={
 group:sql`CASE WHEN "status"='confirmed' AND "confirmationDocumentId" IS NOT NULL THEN "confirmationDocumentId"::text ELSE "id"::text END`,
 order:sql`min(CASE "status" WHEN 'pending' THEN 0 WHEN 'confirmed' THEN 1 ELSE 2 END),max("createdAt") DESC`,
 fields:{date:sql`max("saleDate")`,_date:date('saleDate'),company:text('company'),customer:sql`string_agg("customer",' ')`,item:sql`string_agg("item",' ')`,unit:sql`string_agg("unit",' ')`,quantity:sql`sum("quantity"::numeric)`,cost:sql`sum("purchaseCost"::numeric*"quantity"::numeric)`,status:text('status'),sale:sql`string_agg("saleNumber",' ')`,confirmation:text('confirmationNumber')},
 aliases:{product:'item',contact:'customer',number:'sale'},
};
export const quotationHistory:ListHistoryConfig={
 order:sql`max("documentDate") DESC,max("createdAt") DESC`,
 fields:{number:text('number'),customer:text('customer'),company:text('company'),date:sql`max("documentDate")`,_date:date('documentDate'),validUntil:sql`max("validUntil")`,_valid:date('validUntil'),total:sql`max("grandTotal"::numeric)`,
 status:sql`CASE WHEN max("documentStatus"::text)='cancelled' THEN 'Cancelled' WHEN max("converted"::numeric)>0 AND max("converted"::numeric)>=max("quoted"::numeric) THEN 'Converted' WHEN max("validUntil") < (now() at time zone 'Asia/Karachi')::date THEN 'Expired' WHEN max("converted"::numeric)>0 THEN 'Partly converted' ELSE 'Open' END`,item:sql`max("lines"::text)`},aliases:{contact:'customer',product:'item'},
};
export const movementHistory:ListHistoryConfig={
 order:sql`max("date") DESC,max("createdAt") DESC`,
 fields:{date:sql`max("date")`,_date:date('date'),item:text('itemName'),sku:text('sku'),company:text('company'),location:sql`coalesce(max("location"),'Unassigned')`,type:text('type'),quantity:sql`sum("movement"*"quantity"::numeric)`,unit:sql`coalesce(max("unit"),max("unitName"),'')`,reference:text('reference'),contact:text('contact'),user:text('user'),value:sql`sum("totalCost"::numeric)`},
 aliases:{product:'item',number:'reference',customer:'contact',supplier:'contact'},
};
