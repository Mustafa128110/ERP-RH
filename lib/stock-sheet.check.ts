import assert from "node:assert/strict";
import {stockSheetError,type StockSheetRow} from "./stock-sheet";
const row:StockSheetRow={id:"00000000-0000-0000-0000-000000000001",_revision:"10",companyId:"company",name:"Bolt 5/8x16",sku:"SKU",urduName:"",categoryId:"",categoryName:"",brandId:"",brandName:"",unitId:"",unitName:"",taxable:false,isActive:true,supplierId:"",supplierName:"",purchaseQty:"",purchaseRate:"",targetQty:"",rate1:"1.00",rate2:"",rate3:"",salesRate:"0"};
assert.equal(stockSheetError([row]),null);assert.equal(stockSheetError([{...row,targetQty:"0"}]),null);
assert.match(stockSheetError([row,row])??"",/different/);assert.match(stockSheetError([{...row,_revision:""}])??"",/reload/);
for(const value of ["Infinity","NaN","-1","1e100"])assert.match(stockSheetError([{...row,rate1:value}])??"",/finite/);
assert.match(stockSheetError([{...row,targetQty:"-1"}])??"",/zero or more/);
assert.match(stockSheetError([{...row,sku:""}])??"",/SKU/);
console.log("stock sheet validation rejects duplicate IDs, missing versions and non-finite prices");
