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
import {findProductName,productName} from "@/lib/product-name";
type Options=Awaited<ReturnType<typeof getConversionOptions>>;
type InputRow={itemId:string;itemName:string;unitId:string;unitName:string;quantity:string};
type OutputRow=InputRow&{newName?:string;mode:"existing"|"new";salesRate:string;costShare:string};
type Template={inputs:InputRow[];outputs:OutputRow[]};
const blankInput=():InputRow=>({itemId:"",itemName:"",unitId:"",unitName:"",quantity:""});
const blankOutput=():OutputRow=>({...blankInput(),mode:"new",salesRate:"",costShare:""});
const active=(row:InputRow)=>!!(row.itemId||row.itemName||row.unitId||row.unitName||row.quantity);
const activeOutput=(row:OutputRow)=>active(row)||!!row.salesRate||!!row.costShare;
function trailing<T>(rows:T[],isActive:(row:T)=>boolean,blank:()=>T):T[]{return rows.length&& !isActive(rows[rows.length-1])?rows:[...rows,blank()];}
function shares(rows:OutputRow[]):OutputRow[]{const count=rows.filter(activeOutput).length;let index=0;return rows.map(row=>!activeOutput(row)?row:{...row,costShare:String(++index===count?100-Math.floor(10000/count)/100*(count-1):Math.floor(10000/count)/100)});}
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
 const find=findProductName;
 function patchInput(index:number,patch:Partial<InputRow>){setInputs(current=>trailing(current.map((row,i)=>i===index?{...row,...patch}:row),active,blankInput));}
 function patchOutput(index:number,patch:Partial<OutputRow>){setOutputs(current=>{const next=current.map((row,i)=>i===index?{...row,...patch}:row);return trailing(current.filter(activeOutput).length===next.filter(activeOutput).length||patch.costShare!==undefined?next:shares(next),activeOutput,blankOutput);});}
 function template(value:Template){setInputs(trailing(value.inputs.map(row=>({...row})),active,blankInput));setOutputs(trailing(value.outputs.map(row=>{const existing=find(options.itemOptions,row.itemName);return {...row,...(existing?{mode:"existing" as const,itemId:existing.id}:{})};}),activeOutput,blankOutput));}
 async function submit(event:React.FormEvent){event.preventDefault();if(pending)return;setError("");
  const consumed=inputRows.filter(active),produced=outputRows.filter(activeOutput);
  if(!consumed.length||!produced.length){setError("Add at least one input and one output product.");return;}
  if(consumed.some(row=>!find(options.itemOptions,row.itemName)?.id||!find(options.unitOptions,row.unitName)?.id)||produced.some(row=>!row.itemName.trim()||!find(options.unitOptions,row.unitName)?.id||row.mode==="existing"&&!find(options.itemOptions,row.itemName)?.id)){setError("Choose an existing input product and stock unit in every filled row. Outputs may use a new product name.");return;}
  setPending(true);try{
   const result=await createStockConversion({companyId:options.companyOptions[0]?.id??"",channelId,locationId:locationId==="unassigned"?null:locationId,documentDate:date,note,operationId,
    inputs:consumed.map(row=>({itemId:find(options.itemOptions,row.itemName)!.id,unitId:find(options.unitOptions,row.unitName)!.id,quantity:Number(row.quantity)})),
    outputs:produced.map(row=>({itemId:row.mode==="existing"?find(options.itemOptions,row.itemName)!.id:"",newName:row.mode==="new"?row.itemName:undefined,unitId:find(options.unitOptions,row.unitName)!.id,quantity:Number(row.quantity),salesRate:Number(row.salesRate),costShare:Number(row.costShare)}))});
   if(result.error)setError(result.error);else if(result.success){const saved={inputs:consumed,outputs:produced};const old=readDraft<Template[]>(historyKey)??[];saveDraft(historyKey,[saved,...old.filter(row=>JSON.stringify(row)!==JSON.stringify(saved))].slice(0,20));resetDraftSnapshot(historyKey);onDone();}
  }catch{setError("Could not store the conversion. Your rows are preserved; retry the same operation.");}finally{setPending(false);}
 }
 const unit=(row:InputRow,change:(patch:Partial<InputRow>)=>void,label:string)=><ComboBox value={row.unitName??options.unitOptions.find(unit=>unit.id===row.unitId)?.name??""} options={options.unitOptions} placeholder="Choose stock unit" inputProps={{"aria-label":label}} className={field} onChange={name=>change({unitName:name,unitId:find(options.unitOptions,name)?.id??""})}/>;
 const product=(row:InputRow,change:(patch:Partial<InputRow>&{salesRate?:string})=>void,label:string)=><ComboBox value={row.itemName??options.itemOptions.find(item=>item.id===row.itemId)?.name??""} options={options.itemOptions} placeholder="Choose product" inputProps={{"aria-label":label}} className={field} onChange={name=>{const item=find(options.itemOptions,name);const detail=options.itemOptions.find(option=>option.id===item?.id);const base=options.unitOptions.find(unit=>unit.id===detail?.baseUnitId);change({itemName:name,itemId:item?.id??"",...(detail?{unitId:base?.id??"",unitName:base?.name??"",salesRate:detail.salesRate??"0"}:{})});}}/>;
 return <form ref={form} onSubmit={event=>void submit(event)} className="flex flex-col gap-4">
  {history.length>0&&<label className="text-sm">Reuse a previous conversion<select aria-label="Recent conversions" value="" className={field} onChange={event=>{if(event.target.value!=="")template(history[Number(event.target.value)]);}}><option value="">Choose saved quantities and products…</option>{history.map((row,index)=><option key={index} value={index}>{row.inputs.map(input=>`${input.quantity} ${productName(input.itemName)}`).join(" + ")} → {row.outputs.map(output=>`${output.quantity} ${productName(output.itemName)}`).join(" + ")}</option>)}</select></label>}
  <div className="flex flex-wrap gap-3"><ChannelField value={channelId} onChange={setChannelId}/><label className="text-sm">Warehouse<select required value={locationId} onChange={event=>setLocationId(event.target.value)} className={field}><option value="">Choose warehouse</option>{options.canUseUnassigned&&<option value="unassigned">Unassigned</option>}{options.locationOptions.map(location=><option key={location.id} value={location.id}>{location.name}</option>)}</select></label><label className="text-sm">Date<DateField required value={date} onChange={setDate} className={field}/></label></div>
  <p className="text-sm text-steel">Arrow keys navigate cells; Ctrl+Enter saves. A blank row appears as you type. Negative stock can be consumed; any shortage uses the recorded average incoming cost (zero if none is recorded). Review the quantities and cost shares before posting.</p>
  <section><h3 className="mb-2 font-medium">Consume</h3><div className="overflow-x-auto"><table className="w-full min-w-[640px] table-fixed text-sm"><colgroup><col style={{width:"45%"}}/><col style={{width:"25%"}}/><col style={{width:"20%"}}/><col style={{width:"10%"}}/></colgroup><thead><tr>{["Product","Unit","Quantity",""].map((label,index)=><th key={index} className="p-2 text-left">{label}</th>)}</tr></thead><tbody ref={inputBody} {...gridSelectionProps} onKeyDown={event=>gridKeyDown(event,inputBody,()=>form.current?.requestSubmit())}>{inputRows.map((row,index)=><tr key={index}><td className="p-1">{product(row,patch=>patchInput(index,patch),`Input product ${index+1}`)}</td><td className="p-1">{unit(row,patch=>patchInput(index,patch),`Input stock unit ${index+1}`)}</td><td className="p-1"><input aria-label={`Input quantity ${index+1}`} placeholder="Quantity" required={active(row)} type="number" min="0.001" step="0.001" className={field} value={row.quantity} onChange={event=>patchInput(index,{quantity:event.target.value})}/></td><td><button type="button" disabled={!active(row)} aria-label={`Remove input ${index+1}`} onClick={()=>setInputs(current=>trailing(current.filter((_,i)=>i!==index),active,blankInput))}>Remove</button></td></tr>)}</tbody></table></div></section>
  <section><h3 className="mb-2 font-medium">Produce</h3><div className="overflow-x-auto"><table className="w-full min-w-[1150px] table-fixed text-sm"><colgroup>{[360,220,160,180,160,70].map((width,index)=><col key={index} style={{width}}/>)}</colgroup><thead><tr>{["Product","Unit / New base unit","Quantity","Selling rate","Cost share %",""].map((label,index)=><th key={index} className="p-2 text-left">{label}</th>)}</tr></thead><tbody ref={outputBody} {...gridSelectionProps} onKeyDown={event=>gridKeyDown(event,outputBody,()=>form.current?.requestSubmit())}>{outputRows.map((row,index)=><tr key={index}><td className="p-1"><div className="flex gap-1"><select aria-label={`Output product mode ${index+1}`} value={row.mode} className="max-w-24 rounded border border-sand" onChange={event=>patchOutput(index,{mode:event.target.value as OutputRow["mode"],itemId:"",itemName:""})}><option value="new">New</option><option value="existing">Existing</option></select>{row.mode==="new"?<input aria-label={`New product name ${index+1}`} placeholder="New product name" className={field} value={row.itemName??""} onChange={event=>patchOutput(index,{itemName:event.target.value})}/>:product(row,patch=>patchOutput(index,patch),`Output product ${index+1}`)}</div></td><td className="p-1">{unit(row,patch=>patchOutput(index,patch),`Output stock unit ${index+1}`)}</td>{(["quantity","salesRate","costShare"] as const).map(key=><td key={key} className="p-1"><input aria-label={`Output ${key==="quantity"?"quantity":key==="salesRate"?"selling rate":"cost share"} ${index+1}`} required={activeOutput(row)} placeholder={key==="quantity"?"Quantity":key==="salesRate"?"0.00":"100"} type="number" min={key==="salesRate"?"0":"0.001"} max={key==="costShare"?"100":undefined} step="any" value={row[key]} onChange={event=>patchOutput(index,{[key]:event.target.value})} className={field}/></td>)}<td><button type="button" disabled={!activeOutput(row)} aria-label={`Remove output ${index+1}`} onClick={()=>setOutputs(current=>trailing(shares(current.filter((_,i)=>i!==index)),activeOutput,blankOutput))}>Remove</button></td></tr>)}</tbody></table></div><p className="mt-2 text-xs text-steel">Cost shares must total 100%. Recent conversions are saved for this user on this device.</p></section>
  <label className="text-sm">Note<input placeholder="Conversion note" value={note} onChange={event=>setNote(event.target.value)} className={field}/></label>{error&&<p role="alert" className="text-sm text-error">{error}</p>}<button type="submit" disabled={pending} className="self-end rounded bg-navy-800 px-4 py-2 text-sm text-white disabled:opacity-50">{pending?"Storing…":"Post conversion"}</button>
 </form>;
}
