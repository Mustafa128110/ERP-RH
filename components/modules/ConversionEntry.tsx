"use client";
import {useEffect,useRef,useState,useSyncExternalStore} from "react";
import {createStockConversion,type getConversionOptions} from "@/lib/client-actions/stock-conversions";
import {useChannels,ChannelField} from "@/components/layout/ChannelProvider";
import {entryChannel} from "@/lib/sale-constants";
import {useRecoveryState} from "@/components/ui/FormRecovery";
import {DateField} from "@/components/ui/DateField";
import {ComboBox} from "@/components/ui/ComboBox";
import {gridKeyDown,gridSelectionProps} from "@/components/ui/grid-keys";
import {scopedDraftKey,useClientUserId} from "@/lib/client-user";
import {readDraft,saveDraft,subscribeDraft,draftSnapshot,noDraft,resetDraftSnapshot} from "@/lib/draft";
import {saveClientCache} from "@/lib/client-cache";
import {todayISO} from "@/lib/format";
import {gridCellInputClass as cellInput,gridHeadingClass as thClass,gridCellClass as tdClass} from "@/components/ui/form-styles";
import {useTableColumnLayout} from "@/components/ui/useTableColumnLayout";
import type {ColumnDef} from "@/lib/table";
import {blankConversionLine,conversionLines,validateConversion} from "@/lib/stock-conversion";
import {findProductName,productName} from "@/lib/product-name";
type Options=Awaited<ReturnType<typeof getConversionOptions>>;
type InputRow={itemId:string;itemName:string;unitId:string;unitName:string;quantity:string};
type OutputRow=InputRow&{newName?:string;mode:"existing"|"new";salesRate:string;costShare:string};
type Template={inputs:InputRow[];outputs:OutputRow[]};
const blankInput=():InputRow=>({itemId:"",itemName:"",unitId:"",unitName:"",quantity:""});
const blankOutput=():OutputRow=>({...blankInput(),mode:"new",salesRate:"",costShare:""});
const active=(row:InputRow)=>!!(row.itemId||row.itemName||row.unitId||row.unitName||row.quantity);
const activeOutput=(row:OutputRow)=>!blankConversionLine(row);
function trailing<T>(rows:T[],isActive:(row:T)=>boolean,blank:()=>T):T[]{return rows.length&& !isActive(rows[rows.length-1])?rows:[...rows,blank()];}
function shares(rows:OutputRow[]):OutputRow[]{const count=rows.filter(activeOutput).length;let index=0;return rows.map(row=>!activeOutput(row)?row:{...row,costShare:String(++index===count?100-Math.floor(10000/count)/100*(count-1):Math.floor(10000/count)/100)});}
const inputColumns:ColumnDef[]=[{key:"__sno",label:"#"},{key:"item",label:"Product"},{key:"unit",label:"Unit"},{key:"quantity",label:"Quantity",align:"right"},{key:"remove",label:""}];
const outputColumns:ColumnDef[]=[{key:"__sno",label:"#"},{key:"mode",label:"Product type"},{key:"item",label:"Product"},{key:"unit",label:"Unit / New base unit"},{key:"quantity",label:"Quantity",align:"right"},{key:"salesRate",label:"Selling rate",align:"right"},{key:"costShare",label:"Cost share %",align:"right"},{key:"remove",label:""}];
export function ConversionEntry({options,onDone}:{options:Options;onDone:()=>void}){
 const {channels,selected}=useChannels();useClientUserId();
 useEffect(()=>{saveClientCache("locations",options.locationOptions);saveClientCache("units",options.unitOptions);saveClientCache("items",options.itemOptions);},[options]);
 const historyKey=scopedDraftKey("conversion-templates");
 const history=useSyncExternalStore(subscribeDraft,()=>draftSnapshot<Template[]>(historyKey),noDraft)??[];
 const [channelId,setChannelId]=useRecoveryState("channelId",entryChannel(channels,selected));
 const [locationId,setLocationId]=useRecoveryState("locationId",options.locationOptions[0]?.id??(options.canUseUnassigned?"unassigned":""));
 const [date,setDate]=useRecoveryState("documentDate",todayISO()),[note,setNote]=useRecoveryState("note","");
 const [inputs,setInputs]=useRecoveryState<InputRow[]>("inputs",()=>[blankInput()]),[outputs,setOutputs]=useRecoveryState<OutputRow[]>("outputs",()=>[blankOutput()]);
 const [operationId]=useRecoveryState("operationId",()=>crypto.randomUUID());
 const names=(row:InputRow)=>({...row,itemName:row.itemName??options.itemOptions.find(item=>item.id===row.itemId)?.name??"",unitName:row.unitName??options.unitOptions.find(unit=>unit.id===row.unitId)?.name??""});
 const inputRows=inputs.map(names),outputRows=outputs.map(row=>({...row,...names({...row,itemName:row.itemName??row.newName})}));
 const [pending,setPending]=useState(false),[error,setError]=useState("");
 const inputBody=useRef<HTMLTableSectionElement>(null),outputBody=useRef<HTMLTableSectionElement>(null),form=useRef<HTMLFormElement>(null);
 const field="w-full min-w-28 rounded border border-sand bg-white px-2 py-2 text-sm";
 const inputContainer=useRef<HTMLDivElement>(null),outputContainer=useRef<HTMLDivElement>(null);
 const inputLayout=useTableColumnLayout(inputColumns,[],inputContainer),outputLayout=useTableColumnLayout(outputColumns,[],outputContainer);

 const find=findProductName;
 function patchInput(index:number,patch:Partial<InputRow>){setInputs(current=>trailing(current.map((row,i)=>i===index?{...row,...patch}:row),active,blankInput));}
 function patchOutput(index:number,patch:Partial<OutputRow>){setOutputs(current=>{const next=current.map((row,i)=>i===index?{...row,...patch}:row);return trailing(current.filter(activeOutput).length===next.filter(activeOutput).length||patch.costShare!==undefined?next:shares(next),activeOutput,blankOutput);});}
 function template(value:Template){setInputs(trailing(value.inputs.map(row=>({...row})),active,blankInput));setOutputs(trailing(value.outputs.map(row=>{const existing=find(options.itemOptions,row.itemName);return {...row,...(existing?{mode:"existing" as const,itemId:existing.id}:{})};}),activeOutput,blankOutput));}
 async function submit(event:React.FormEvent){event.preventDefault();if(pending)return;setError("");
  const consumed=inputRows.filter(active),produced=outputRows.filter(activeOutput);
  if(!consumed.length||!produced.length){setError("Add at least one input and one output product.");return;}
  for(const [index,row]of consumed.entries()){
   if(!find(options.itemOptions,row.itemName)){setError(`Input row ${index+1}: choose an existing product.`);return;}
   if(!find(options.unitOptions,row.unitName)){setError(`Input row ${index+1}: choose a stock unit.`);return;}
  }
  for(const [index,row]of produced.entries()){
   if(!row.itemName.trim()||row.mode==="existing"&&!find(options.itemOptions,row.itemName)){setError(`Output row ${index+1}: choose an existing product or enter a new product name.`);return;}
   if(!find(options.unitOptions,row.unitName)){setError(`Output row ${index+1}: choose a stock unit.`);return;}
  }
  const payload={companyId:options.companyOptions[0]?.id??"",channelId,locationId:locationId==="unassigned"?null:locationId,documentDate:date,note,operationId,
   ...conversionLines(consumed.map(row=>({itemId:find(options.itemOptions,row.itemName)!.id,unitId:find(options.unitOptions,row.unitName)!.id,quantity:Number(row.quantity)})),
    produced.map(row=>({itemId:row.mode==="existing"?find(options.itemOptions,row.itemName)!.id:"",newName:row.mode==="new"?row.itemName:undefined,unitId:find(options.unitOptions,row.unitName)!.id,quantity:Number(row.quantity),salesRate:Number(row.salesRate),costShare:Number(row.costShare)})))};
  try{validateConversion(payload.inputs,payload.outputs);}catch(problem){setError(problem instanceof Error?problem.message:"Check the conversion rows.");return;}
  setPending(true);try{
   const result=await createStockConversion(payload);
   if(result.error)setError(result.error);else if(result.success){const saved={inputs:consumed,outputs:produced};const old=readDraft<Template[]>(historyKey)??[];saveDraft(historyKey,[saved,...old.filter(row=>JSON.stringify(row)!==JSON.stringify(saved))].slice(0,20));resetDraftSnapshot(historyKey);onDone();}
  }catch{setError("Could not store the conversion. Your rows are preserved; retry the same operation.");}finally{setPending(false);}
 }
 const unit=(row:InputRow,change:(patch:Partial<InputRow>)=>void,label:string)=><ComboBox value={row.unitName??options.unitOptions.find(unit=>unit.id===row.unitId)?.name??""} options={options.unitOptions} placeholder="Unit" inputProps={{"aria-label":label}} className={cellInput} onChange={name=>change({unitName:name,unitId:find(options.unitOptions,name)?.id??""})}/>;
 const product=(row:InputRow,change:(patch:Partial<InputRow>&{salesRate?:string})=>void,label:string)=><ComboBox value={row.itemName??options.itemOptions.find(item=>item.id===row.itemId)?.name??""} options={options.itemOptions} placeholder="Choose product" inputProps={{"aria-label":label}} className={cellInput} onChange={name=>{const item=find(options.itemOptions,name);const detail=options.itemOptions.find(option=>option.id===item?.id);const base=options.unitOptions.find(unit=>unit.id===detail?.baseUnitId);change({itemName:name,itemId:item?.id??"",...(detail?{unitId:base?.id??"",unitName:base?.name??"",salesRate:detail.salesRate??"0"}:{})});}}/>;
 return <form ref={form} onSubmit={event=>void submit(event)} className="flex flex-col gap-4">
  {history.length>0&&<label className="text-sm">Reuse a previous conversion<select aria-label="Recent conversions" value="" className={field} onChange={event=>{if(event.target.value!=="")template(history[Number(event.target.value)]);}}><option value="">Choose saved quantities and products…</option>{history.map((row,index)=><option key={index} value={index}>{row.inputs.map(input=>`${input.quantity} ${productName(input.itemName)}`).join(" + ")} → {row.outputs.map(output=>`${output.quantity} ${productName(output.itemName)}`).join(" + ")}</option>)}</select></label>}
  <div className="flex flex-wrap gap-3"><ChannelField value={channelId} onChange={setChannelId}/><label className="text-sm">Warehouse<select required value={locationId} onChange={event=>setLocationId(event.target.value)} className={field}><option value="">Choose warehouse</option>{options.canUseUnassigned&&<option value="unassigned">Unassigned</option>}{options.locationOptions.map(location=><option key={location.id} value={location.id}>{location.name}</option>)}</select></label><label className="text-sm">Date<DateField required value={date} onChange={setDate} className={field}/></label></div>
  <section className="flex flex-col gap-2">
   <h3 className="text-sm font-semibold text-navy-800">Consume</h3>
   <div ref={inputContainer} className="overflow-x-auto rounded border border-sand">
    <table aria-label="Consumed products" data-column-layout="managed" className="conversion-items-grid table-fixed border-collapse text-sm" style={{width:inputLayout.tableWidth,minWidth:`max(100%, ${inputLayout.minimumWidth}px)`}}>
     <colgroup>{inputColumns.map(column=><col key={column.key} style={{width:inputLayout.getWidth(column)}}/>)}</colgroup>
     <thead><tr>{inputColumns.map(column=><th key={column.key} className={`${thClass} ${column.align==="right"?"text-right":""}`}>{column.label}</th>)}</tr></thead>
     <tbody ref={inputBody} {...gridSelectionProps} onKeyDown={event=>gridKeyDown(event,inputBody,()=>form.current?.requestSubmit())}>
      {inputRows.map((row,index)=><tr key={index}>
       <td className="border border-sand px-2 text-right text-xs tabular-nums text-steel">{index+1}</td>
       <td className={tdClass}>{product(row,patch=>patchInput(index,patch),`Input product ${index+1}`)}</td>
       <td className={tdClass}>{unit(row,patch=>patchInput(index,patch),`Input stock unit ${index+1}`)}</td>
       <td className={tdClass}><input aria-label={`Input quantity ${index+1}`} placeholder="Qty" required={active(row)} type="number" min="0.001" step="0.001" className={`${cellInput} text-right`} value={row.quantity} onChange={event=>patchInput(index,{quantity:event.target.value})}/></td>
       <td className="border border-sand text-center"><button type="button" className="h-9 w-full text-steel hover:text-error disabled:opacity-40" disabled={!active(row)} aria-label={`Remove input ${index+1}`} onClick={()=>setInputs(current=>trailing(current.filter((_,i)=>i!==index),active,blankInput))}>✕</button></td>
      </tr>)}
     </tbody>
    </table>
   </div>
  </section>
  <section className="flex flex-col gap-2">
   <h3 className="text-sm font-semibold text-navy-800">Produce</h3>
   <div ref={outputContainer} className="overflow-x-auto rounded border border-sand">
    <table aria-label="Produced products" data-column-layout="managed" className="conversion-items-grid table-fixed border-collapse text-sm" style={{width:outputLayout.tableWidth,minWidth:`max(100%, ${outputLayout.minimumWidth}px)`}}>
     <colgroup>{outputColumns.map(column=><col key={column.key} style={{width:outputLayout.getWidth(column)}}/>)}</colgroup>
     <thead><tr>{outputColumns.map(column=><th key={column.key} className={`${thClass} ${column.align==="right"?"text-right":""}`}>{column.label}</th>)}</tr></thead>
     <tbody ref={outputBody} {...gridSelectionProps} onKeyDown={event=>gridKeyDown(event,outputBody,()=>form.current?.requestSubmit())}>
      {outputRows.map((row,index)=><tr key={index}>
       <td className="border border-sand px-2 text-right text-xs tabular-nums text-steel">{index+1}</td>
       <td className={tdClass}><select aria-label={`Output product mode ${index+1}`} value={row.mode} className={cellInput} onChange={event=>patchOutput(index,{mode:event.target.value as OutputRow["mode"],itemId:"",itemName:""})}><option value="new">New product</option><option value="existing">Existing product</option></select></td>
       <td className={tdClass}>{row.mode==="new"?<input aria-label={`New product name ${index+1}`} placeholder="New product name" className={cellInput} value={row.itemName??""} onChange={event=>patchOutput(index,{itemName:event.target.value})}/>:product(row,patch=>patchOutput(index,patch),`Output product ${index+1}`)}</td>
       <td className={tdClass}>{unit(row,patch=>patchOutput(index,patch),`Output stock unit ${index+1}`)}</td>
       {(["quantity","salesRate","costShare"] as const).map(key=><td key={key} className={tdClass}><input aria-label={`Output ${key==="quantity"?"quantity":key==="salesRate"?"selling rate":"cost share"} ${index+1}`} required={key!=="salesRate"&&activeOutput(row)} placeholder={key==="quantity"?"Qty":key==="salesRate"?"0.00":"100"} type="number" min={key==="salesRate"?"0":"0.001"} max={key==="costShare"?"100":undefined} step="any" value={row[key]} onChange={event=>patchOutput(index,{[key]:event.target.value})} className={`${cellInput} text-right`}/></td>)}
       <td className="border border-sand text-center"><button type="button" className="h-9 w-full text-steel hover:text-error disabled:opacity-40" disabled={!activeOutput(row)} aria-label={`Remove output ${index+1}`} onClick={()=>setOutputs(current=>trailing(shares(current.filter((_,i)=>i!==index)),activeOutput,blankOutput))}>✕</button></td>
      </tr>)}
     </tbody>
    </table>
   </div>
   <p className="text-xs text-steel">Cost shares must total 100%.</p>
  </section>
  <label className="text-sm">Note<input placeholder="Conversion note" value={note} onChange={event=>setNote(event.target.value)} className={field}/></label>{error&&<p role="alert" className="text-sm text-error">{error}</p>}<button type="submit" disabled={pending} className="self-end rounded bg-navy-800 px-4 py-2 text-sm text-white disabled:opacity-50">{pending?"Storing…":"Post conversion"}</button>
 </form>;
}
