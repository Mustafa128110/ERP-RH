import type {ProductEditInput} from "./actions/products";
export type RateKey="rate1"|"rate2"|"rate3"|"salesRate";
export type StockSheetRow=ProductEditInput&{_revision:string;rate1:string;rate2:string;rate3:string;salesRate:string;rateChanges?:RateKey[]};
export function stockSheetError(rows:StockSheetRow[]):string|null{
 if(!Array.isArray(rows)||!rows.length||rows.length>2000)return "Save between 1 and 2,000 changed products at a time.";
 const ids=new Set<string>();
 for(const [index,row]of rows.entries()){
  const label=`Row ${index+1}`;
  if(!row||!/^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.test(row.id)||ids.has(row.id))return `${label}: choose a different existing product in each row.`;
  ids.add(row.id);
  if(row.rateChanges!==undefined&&(!Array.isArray(row.rateChanges)||row.rateChanges.some(key=>!["rate1","rate2","rate3","salesRate"].includes(key))))return `${label}: the edited price columns are invalid.`;
  if(typeof row._revision!=="string"||!/^\d+$/.test(row._revision))return `${label}: reload the product before editing it.`;
  if(typeof row.name!=="string"||!row.name.trim()||row.name.length>255||typeof row.sku!=="string"||!row.sku.trim()||row.sku.length>100)return `${label}: enter a name (up to 255 characters) and SKU (up to 100).`;
  for(const key of ["rate1","rate2","rate3","salesRate"] as const){const value=row[key];if(typeof value!=="string"||value!==""&&(!Number.isFinite(Number(value))||Number(value)<0||Number(value)>99999999999))return `${label}: ${key} must be a finite price, zero or more.`;}
  if(typeof row.targetQty!=="string"||row.targetQty!==""&&(!Number.isFinite(Number(row.targetQty))||Number(row.targetQty)<0))return `${label}: counted stock must be zero or more.`;
 }
 return null;
}
