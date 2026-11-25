import {tableForCommand} from "./command-tables";
import {commandFields,type SavedCommand,type CommandValue} from "./command-protocol";
type RecordValue=Record<string,unknown>;
const object=(value:unknown):value is RecordValue=>!!value&&typeof value==="object"&&!Array.isArray(value);
export function projectLocalRecords<T>(records:T[],idKey:keyof T&string,table:string|undefined,commands:SavedCommand[],servedAt:number):{records:T[];pending:string[]} {
 let result=records;const pending=new Set<string>();
 if(!table)return {records,pending:[]};
 for(const command of commands){
  if(tableForCommand(command.action)!==table||command.compactedAt||!["pending","syncing","confirmed"].includes(command.status)||command.status==="confirmed"&&command.updatedAt<=servedAt)continue;
  const name=command.action.split(".")[1];
  if(/^delete/.test(name)){
   const ids=command.args.flatMap(arg=>typeof arg==="string"?[arg]:Array.isArray(arg)?arg.filter((value):value is string=>typeof value==="string"):[]);
   for(const row of result)if(ids.includes(String(row[idKey])))pending.add(String(row[idKey]));
   result=result.filter(row=>!ids.includes(String(row[idKey])));continue;
  }
  const field=commandFields(command.args);
  const batch=command.args.find(arg=>Array.isArray(arg)&&arg.some(object));
  const changes:RecordValue[]=Array.isArray(batch)?batch.flatMap(value=>object(value)?[value]:[]):[];
  if(!changes.length){const id=command.args.find(arg=>typeof arg==="string");changes.push({id:typeof id==="string"?id:"",...field});}
  // These are clearly labelled local drafts, using only submitted values.
  // Financial creates stay in Pending Work until their official number and
  // derived amounts are confirmed. A table cannot fabricate those balances.
  if(/^create/.test(name)&&["items","brands","categories","contacts","locations","units","bank_accounts","cash_accounts","taxes","companies"].includes(table)){
   changes.forEach((change,index)=>{
    const draftId=`local:${command.id}:${index}`;
    if(!change.name&&!change.displayName)return;
    const values=Object.fromEntries(Object.entries(change).filter(([key,value])=>!key.startsWith("_")&&!/password|token|secret/i.test(key)&&(["string","number","boolean"].includes(typeof value)||value===null)));
    result=[{...values,[idKey]:draftId,name:change.name??change.displayName,_localDraft:true} as T,...result];pending.add(draftId);
   });continue;
  }
  for(const change of changes){
   const id=String(change.id??change.itemId??"");if(!id)continue;
   const row=result.find(row=>String(row[idKey])===id);if(!row)continue;
   pending.add(id);
   if(/^delete/.test(name)){result=result.filter(row=>String(row[idKey])!==id);continue;}
   if(!/^(update|save|set|assign)/.test(name))continue;
   const patch:RecordValue={};
   for(const [key,value]of Object.entries(change)){
    if(key===idKey||key.startsWith("_")||/password|token|secret/i.test(key)||!(key in (row as RecordValue)))continue;
    if(["string","number","boolean"].includes(typeof value)||value===null)patch[key]=value;
   }
   if(table==="items"){
    if(typeof change.unitId==="string")patch._baseUnitId=change.unitId;
    if(Array.isArray(change.ruleIds)){patch._ruleIds=change.ruleIds.join(",");patch._hasUnitRule=change.ruleIds.length>0;}
    if(typeof change.baseUnitId==="string"){patch._baseUnitId=change.baseUnitId;patch._hasBaseUnit=!!change.baseUnitId;}
    if(typeof change.categoryName==="string"&&change.categoryName)patch.category=change.categoryName;
    if(typeof change.brandName==="string"&&change.brandName)patch.brand=change.brandName;
    if(typeof change.targetQty==="string"&&change.targetQty!==""){patch.onHand=`${change.targetQty} (count pending)`;}
   }
   result=result.map(current=>String(current[idKey])===id?{...current,...patch}:current);
  }
 }
 return {records:result,pending:[...pending]};
}
export function correctionRows(args:CommandValue[]):RecordValue[]{
 const rows=args.find(arg=>Array.isArray(arg)&&arg.some(object));
 return Array.isArray(rows)?rows.flatMap(value=>object(value)?[value]:[]):[];
}
