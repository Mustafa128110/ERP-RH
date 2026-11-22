import {OperationError} from "./operation-errors";
export type ConversionInput = {itemId:string;unitId:string;quantity:number};
export type ConversionOutput = {itemId:string;newName?:string;unitId:string;quantity:number;salesRate:number;costShare:number};
export function conversionCostShares(total:number,shares:number[]):number[]{
 if(!Number.isFinite(total)||total<0)throw new OperationError("The recorded input cost is invalid.");
 if(!shares.length||shares.some(share=>!Number.isFinite(share)||share<=0)||Math.abs(shares.reduce((sum,share)=>sum+share,0)-100)>0.001)throw new OperationError("Output cost shares must be positive and add up to 100%.");
 const cents=Math.round(total*100),exact=shares.map(share=>cents*share/100),allocated=exact.map(Math.floor);
 let remaining=cents-allocated.reduce((sum,value)=>sum+value,0);
 const priority=exact.map((value,index)=>({index,fraction:value-allocated[index]})).sort((a,b)=>b.fraction-a.fraction||a.index-b.index);
 for(const {index} of priority){if(!remaining)break;allocated[index]++;remaining--;}
 return allocated.map(value=>value/100);
}
export function validateConversion(inputs:ConversionInput[],outputs:ConversionOutput[]){
 if(!inputs.length||!outputs.length)throw new OperationError("Add at least one input and one output product.");
 if(inputs.length+outputs.length>200)throw new OperationError("Use at most 200 conversion lines per document.");
 if(inputs.some(row=>!row.itemId||!row.unitId||!Number.isFinite(row.quantity)||row.quantity<=0))throw new OperationError("Choose an input product, unit and a quantity greater than zero on every line.");
 if(new Set(inputs.map(row=>row.itemId)).size!==inputs.length)throw new OperationError("Combine duplicate input products into one line.");
 if(outputs.some(row=>(!row.itemId&&!row.newName?.trim())||!row.unitId||!Number.isFinite(row.quantity)||row.quantity<=0||!Number.isFinite(row.salesRate)||row.salesRate<0))throw new OperationError("Choose or name every output product, with a unit, positive quantity and valid selling rate.");
 if(outputs.some(row=>inputs.some(input=>input.itemId===row.itemId)))throw new OperationError("Use a different output product. A change of unit for the same product belongs in its unit rules.");
 const keys=outputs.map(row=>row.itemId||`new:${row.newName!.trim().toLowerCase()}`);
 if(new Set(keys).size!==outputs.length)throw new OperationError("Combine duplicate output products into one line.");
 conversionCostShares(0,outputs.map(row=>row.costShare));
}
