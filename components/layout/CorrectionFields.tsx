"use client";
import {useRef} from "react";
import type {CommandValue} from "@/lib/command-protocol";
import {readClientCache} from "@/lib/client-cache";
import {gridKeyDown,gridSelectionProps} from "@/components/ui/grid-keys";
export const fieldLabel=(key:string)=>key.replace(/Json$/,"").replace(/([a-z])([A-Z])/g,"$1 $2").replace(/^./,c=>c.toUpperCase());
const internal=/^(operationId|confirmAllocations|confirm|confirmed|_revision)$/;
const references:Record<string,string>={companyId:"companies",itemId:"items",unitId:"units",baseUnitId:"units",contactId:"contacts",supplierId:"contacts",bankAccountId:"bankAccounts",cashAccountId:"cashAccounts",locationId:"locations",categoryId:"categories",brandId:"brands"};
type Props={value:CommandValue;label:string;onChange:(value:CommandValue)=>void;disabled:boolean};
function Grid({rows,label,onChange,disabled}:{rows:{[key:string]:CommandValue}[];label:string;onChange:(rows:CommandValue[])=>void;disabled:boolean}){
 const body=useRef<HTMLTableSectionElement>(null),keys=[...new Set(rows.flatMap(row=>Object.keys(row)))].filter(key=>!internal.test(key));
 return <div className="my-3 overflow-x-auto"><table aria-label={`${fieldLabel(label)} corrections`} className="w-full min-w-full text-sm"><thead><tr>{keys.map(key=><th key={key} className="min-w-48 p-2 text-left">{fieldLabel(key)}</th>)}</tr></thead><tbody ref={body} {...gridSelectionProps} onKeyDown={event=>gridKeyDown(event,body)}>{rows.map((row,index)=><tr key={index}>{keys.map(key=><td key={key} className="p-1 align-top"><CorrectionFields value={row[key]??""} label={key} disabled={disabled||key==="id"} onChange={next=>onChange(rows.map((old,i)=>i===index?{...old,[key]:next}:old))}/></td>)}</tr>)}</tbody></table></div>;
}
export function CorrectionFields({value,label,onChange,disabled}:Props){
 if(value===null)return <CorrectionFields value="" label={label} onChange={onChange} disabled={disabled}/>;
 if(typeof value==="object"&&!Array.isArray(value)&&Array.isArray(value.$form)){
  const fields=value.$form;
  return <div className="space-y-3">{(fields as string[][]).map(([key,item],index)=>internal.test(key)?null:<CorrectionFields key={`${key}:${index}`} label={key} value={item} disabled={disabled||/Id$/.test(key)&&!references[key]} onChange={next=>onChange({$form:fields.map((pair,i)=>i===index?[key,String(next??"")]:pair)})}/>)}</div>;
 }
 if(Array.isArray(value)){
  if(value.length&&value.every(row=>row&&typeof row==="object"&&!Array.isArray(row)))return <Grid rows={value as {[key:string]:CommandValue}[]} label={label} disabled={disabled} onChange={onChange}/>;
  const rows=value;return <div className="space-y-3">{rows.map((item,index)=><fieldset key={index} className="rounded border border-sand p-2"><legend>{fieldLabel(label)} {index+1}</legend><CorrectionFields value={item} label="Value" disabled={disabled} onChange={next=>onChange(rows.map((old,i)=>i===index?next:old))}/></fieldset>)}</div>;
 }
 if(typeof value==="object")return <div className="grid gap-3 sm:grid-cols-2">{Object.entries(value).map(([key,item])=>internal.test(key)?null:<CorrectionFields key={key} label={key} value={item} disabled={disabled||key==="id"||/Id$/.test(key)&&!references[key]} onChange={next=>onChange({...value as object,[key]:next})}/>)}</div>;
 if(typeof value==="string"&&/Json$/.test(label)){let parsed:CommandValue=null;try{parsed=JSON.parse(value) as CommandValue;}catch{/* Preserve malformed input for correction. */}if(parsed&&typeof parsed==="object")return <CorrectionFields value={parsed} label={label} disabled={disabled} onChange={next=>onChange(JSON.stringify(next))}/>;}
 const options=references[label]?readClientCache<{id:string;name?:string;displayName?:string}[]>(references[label])??[]:[];
 return <label className="flex flex-col gap-1 text-xs text-steel">{fieldLabel(label)}
  {options.length?<select aria-label={fieldLabel(label)} className="rounded border border-sand bg-white p-2 text-sm text-ink" disabled={disabled} value={String(value)} onChange={event=>onChange(event.target.value)}><option value="">Choose {fieldLabel(label).replace(/ Id$/,"").toLowerCase()}</option>{!options.some(row=>row.id===value)&&value&&<option value={String(value)}>Current selection (reload choices)</option>}{options.map(row=><option key={row.id} value={row.id}>{row.name??row.displayName??row.id}</option>)}</select>:typeof value==="boolean"?<input type="checkbox" checked={value} disabled={disabled} onChange={event=>onChange(event.target.checked)}/>:<input aria-label={fieldLabel(label)} placeholder={fieldLabel(label)} className="w-full min-w-36 rounded border border-sand bg-white px-2 py-2 text-sm text-ink read-only:bg-ivory" value={String(value)} readOnly={disabled||!!references[label]} type={typeof value==="number"?"number":"text"} step="any" onChange={event=>onChange(typeof value==="number"?Number(event.target.value):event.target.value)}/>}
 </label>;
}
