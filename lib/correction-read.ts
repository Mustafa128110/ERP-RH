import {tableForCommand} from "./command-tables";
import type {SavedCommand} from "./command-protocol";
const getters:Record<string,string>={products:"getProductsForEdit",contacts:"getContactsForEdit",sales:"getSale",purchases:"getStockPurchase",payments:"getPayment",quotations:"getQuotation","stock-adjustments":"getStockAdjustment","stock-transfers":"getStockTransfer",companies:"getCompany",categories:"getCategory",units:"getUnit",taxes:"getTax",roles:"getRoleForEdit","unit-conversions":"getUnitConversion"};
const lists:Record<string,string>={brands:"listBrands",locations:"listLocations",accounts:"listCheques"};
export function correctionRead(entry:SavedCommand):{action:string;args:unknown[]}|null{
 const domain=entry.action.split(".")[0],table=tableForCommand(entry.action);
 const ids=Object.keys(entry.revisions??{}).filter(key=>key.startsWith(`${table}:`)).map(key=>key.slice(table!.length+1));
 if(!ids.length)return null;
 if(getters[domain])return {action:`${domain}.${getters[domain]}`,args:[domain==="products"||domain==="contacts"?ids:ids[0]]};
 const name=domain==="accounts"?(table==="bank_accounts"?"listBankAccounts":table==="cash_accounts"?"listCashAccounts":"listCheques"):lists[domain];
 return name?{action:`${domain}.${name}`,args:[]}:null;
}
