"use client";
import {useEffect,useMemo,useState} from "react";
import {getProductsForEdit,saveStockSheet,type ProductEditData} from "@/lib/client-actions/products";
import {stockSheetError,type StockSheetRow,type RateKey} from "@/lib/stock-sheet";
import {DataTable} from "@/components/ui/DataTable";
import {DateField} from "@/components/ui/DateField";
import {ComboBox} from "@/components/ui/ComboBox";
import {WorkspaceControls} from "@/components/layout/TableWorkspace";
import {useChannels,ChannelField} from "@/components/layout/ChannelProvider";
import {entryChannel} from "@/lib/sale-constants";
import {ADJUSTMENT_REASONS} from "@/lib/adjustment-constants";
import {scopedDraftKey} from "@/lib/client-user";
import {readDraft,saveDraft,clearDraft} from "@/lib/draft";
import {readClientCache,saveClientCache} from "@/lib/client-cache";
import {todayISO} from "@/lib/format";
import type {ColumnDef,Row} from "@/lib/table";
type Option={id:string;name:string};
type Saved={rows:StockSheetRow[];locationId:string;date:string;reason:string;saleType:string};
export function StockSheet({source,categoryOptions,brandOptions,onClose}:{source:Row[];categoryOptions:Option[];brandOptions:Option[];onClose:()=>void}){
 const {channels,selected}=useChannels();
 const [initialSource]=useState(source);
 const [data,setData]=useState<ProductEditData|null>(null),[rows,setRows]=useState<StockSheetRow[]>([]),[original,setOriginal]=useState<StockSheetRow[]>([]);
 const [cached,setCached]=useState(false);
 const [error,setError]=useState(""),[busy,setBusy]=useState(false),[draft,setDraft]=useState<Saved|null>(null);
 const [locationId,setLocation]=useState(""),[date,setDate]=useState(todayISO),[reason,setReason]=useState("Count Correction"),[saleType,setSaleType]=useState(entryChannel(channels,selected));
 useEffect(()=>{let live=true;const load=async()=>{if(!navigator.onLine){const previous=readClientCache<ProductEditData>("stockSheet");if(previous){const ids=new Set(initialSource.map(row=>String(row.id)));return {result:{...previous,rows:previous.rows.filter(row=>ids.has(row.id))},cached:true};}}const result=await getProductsForEdit(initialSource.map(row=>String(row.id)));saveClientCache("stockSheet",result);saveClientCache("locations",result.locationOptions);saveClientCache("units",result.unitOptions);return {result,cached:false};};void load().then(({result,cached})=>{
  if(!live)return;setCached(cached);setDraft(readDraft<Saved>(scopedDraftKey("stock-sheet")));setData(result);const byId=new Map(initialSource.map(row=>[row.id,row]));
  const next=result.rows.map(row=>{const shown=byId.get(row.id);const price=(key:string)=>shown?.[key]==null?"":String(shown[key]).replaceAll(",","");return {id:row.id,_revision:row._revision,companyId:row.companyId,name:row.name,sku:row.sku,urduName:row.urduName??"",categoryId:row.categoryId??"",categoryName:row.categoryName??"",brandId:row.brandId??"",brandName:row.brandName??"",taxable:row.taxable,isActive:row.isActive,unitId:row.baseUnitId??"",unitName:result.unitOptions.find(unit=>unit.id===row.baseUnitId)?.name??"",ruleIds:row.ruleIds,supplierId:"",supplierName:"",purchaseQty:"",purchaseRate:"",targetQty:"",rate1:price("rate1"),rate2:price("rate2"),rate3:price("rate3"),salesRate:price("salesRate")};});
  setRows(next);setOriginal(next);
 }).catch(()=>{if(live)setError("Could not load the stock sheet. Your saved draft is retained. Reconnect and reopen the editor.");});return()=>{live=false;};},[initialSource]);
 const originalById=useMemo(()=>new Map(original.map(row=>[row.id,row])),[original]);
 const stockById=useMemo(()=>new Map(data?.rows.map(row=>[row.id,row])??[]),[data]);
 const sourceById=useMemo(()=>new Map(source.map(row=>[row.id,row])),[source]);
 const changed=rows.filter(row=>row!==originalById.get(row.id)&&JSON.stringify(row)!==JSON.stringify(originalById.get(row.id)));
 function preserve(next:StockSheetRow[],meta:Partial<Saved>={}){const edits=next.filter(row=>row!==originalById.get(row.id)&&JSON.stringify(row)!==JSON.stringify(originalById.get(row.id)));saveDraft(scopedDraftKey("stock-sheet"),{rows:edits,locationId,date,reason,saleType,...meta});}
 function patch(id:string,values:Partial<StockSheetRow>){const priceKeys=Object.keys(values).filter((key):key is RateKey=>["rate1","rate2","rate3","salesRate"].includes(key));const next=rows.map(row=>row.id===id?{...row,...values,...(priceKeys.length?{rateChanges:[...new Set([...(row.rateChanges??[]),...priceKeys])]}:{})}:row);setRows(next);preserve(next);}
 async function save(){if(busy)return;const invalid=stockSheetError(changed);if(invalid){setError(invalid);return;}const counts=changed.some(row=>row.targetQty!=="");if(counts&&!locationId){setError("Choose the warehouse for the counted stock.");return;}setBusy(true);setError("");try{const result=await saveStockSheet(changed,{mode:counts?"adjust":"none",locationId,documentDate:date,reason,saleType});if(result.error)setError(result.error);else{clearDraft(scopedDraftKey("stock-sheet"));onClose();}}catch{setError("Could not store these edits. Your draft is retained.");}finally{setBusy(false);}}
 const field="w-full min-w-0 rounded border border-sand bg-white px-2 py-2 text-sm";
 const text=(key:keyof StockSheetRow,label:string,width:number,numeric=false):ColumnDef=>({key,label,width,align:numeric?"right":undefined,render:row=><input aria-label={`${label}: ${row.name}`} placeholder={label} type={numeric?"number":"text"} step={numeric?"any":undefined} min={numeric?0:undefined} disabled={busy} className={field} value={String(row[key]??"")} onChange={event=>patch(String(row.id),{[key]:event.target.value})}/>});
 const lookup=(key:"categoryName"|"brandName"|"unitName",idKey:"categoryId"|"brandId"|"unitId",label:string,width:number,options:Option[]):ColumnDef=>({key,label,width,render:row=><ComboBox value={String(row[key])} options={options} placeholder={label} className={field} inputProps={{"aria-label":`${label}: ${row.name}`,disabled:busy}} onChange={value=>patch(String(row.id),{[key]:value,[idKey]:options.find(option=>option.name===value)?.id??""})}/>});
 const columns:ColumnDef[]=[text("sku","SKU",112),text("name","Product name",220),text("urduName","Urdu name",160),lookup("categoryName","categoryId","Category",140,categoryOptions),lookup("brandName","brandId","Brand",128,brandOptions),lookup("unitName","unitId","Base unit",112,data?.unitOptions??[]),{key:"ruleIds",label:"Unit rules",width:184,render:row=><div className="flex flex-wrap gap-2">{data?.ruleOptions.map(rule=><label key={rule.id} className="inline-flex items-center gap-1 text-xs"><input type="checkbox" disabled={busy} checked={String(row._ruleIds??"").split(",").includes(rule.id)} onChange={event=>{const ids=String(row._ruleIds??"").split(",").filter(Boolean);patch(String(row.id),{ruleIds:event.target.checked?[...ids,rule.id]:ids.filter(id=>id!==rule.id)});}}/>{rule.name}</label>)}</div>},{key:"onHand",label:"Current stock",width:108,align:"right"},text("targetQty","Counted stock",104,true),text("salesRate","Sales rate",108,true),text("rate1","Purchase rate 1",108,true),text("rate2","Purchase rate 2",108,true),text("rate3","Purchase rate 3",108,true),...(["taxable","isActive"] as const).map(key=>({key,label:key==="taxable"?"Taxable":"Active",width:76,render:(row:Row)=><input type="checkbox" aria-label={`${key}: ${row.name}`} disabled={busy} checked={row[key]===true} onChange={event=>patch(String(row.id),{[key]:event.target.checked})}/>}))];
 const tableRows:Row[]=rows.map(({rateChanges,ruleIds,...row})=>({...row,_rateChanges:rateChanges?.join(",")??"",ruleIds:null,_ruleIds:ruleIds?.join(",")??"",onHand:locationId?stockById.get(row.id)?.stock.filter(stock=>(stock.locationId??"unassigned")===locationId).reduce((sum,stock)=>sum+stock.onHand,0)??0:sourceById.get(row.id)?.onHand??"—"}));
 return <div className="flex min-h-0 flex-1 flex-col gap-3" aria-label="Inline stock editor">
  <WorkspaceControls label="Stock sheet actions" className="flex flex-wrap items-center gap-3">
   <button type="button" disabled={busy||!data||!changed.length} onClick={()=>void save()} className="rounded bg-navy-800 px-4 py-2 text-sm text-white disabled:opacity-40">{busy?"Storing…":`Save page${changed.length?` (${changed.length})`:""}`}</button>
   <button type="button" disabled={busy} onClick={onClose} className="rounded border border-sand px-3 py-2 text-sm">Close editor · keep draft</button>
   <label className="text-sm">Count warehouse<select aria-label="Count warehouse" value={locationId} className={field} disabled={changed.some(row=>row.targetQty!=="")} onChange={event=>{setLocation(event.target.value);preserve(rows,{locationId:event.target.value});}}><option value="">All stock · choose to count</option><option value="unassigned">Unassigned</option>{data?.locationOptions.map(location=><option key={location.id} value={location.id}>{location.name}</option>)}</select></label>
   <label className="text-sm">Count date<DateField value={date} onChange={value=>{setDate(value);preserve(rows,{date:value});}} className={field}/></label>
   <label className="text-sm">Count reason<select value={reason} onChange={event=>{setReason(event.target.value);preserve(rows,{reason:event.target.value});}} className={field}>{ADJUSTMENT_REASONS.map(value=><option key={value}>{value}</option>)}</select></label><ChannelField value={saleType} onChange={value=>{setSaleType(value);preserve(rows,{saleType:value});}}/>
  </WorkspaceControls>
  <WorkspaceControls label="Stock sheet help"><p className="text-xs text-steel">Edit cells directly; arrow keys navigate and Ctrl+Enter saves. Prices set defaults for new entries. Counted stock posts a warehouse adjustment; leave blank to keep quantity. Valuation is calculated from stock history.</p></WorkspaceControls>
  {draft&&<div className="flex flex-wrap items-center gap-3 rounded border border-brass-600 p-2 text-sm"><span>A previous stock sheet draft is available.</span><button type="button" disabled={!data} onClick={()=>{const saved=new Map(draft.rows.map(row=>[row.id,row]));setRows(current=>current.map(row=>saved.get(row.id)??row));setLocation(draft.locationId);setDate(draft.date);setReason(draft.reason);setSaleType(draft.saleType);setDraft(null);}}>Resume draft</button><button type="button" onClick={()=>{clearDraft(scopedDraftKey("stock-sheet"));setDraft(null);}}>Discard draft</button></div>}
  {cached&&<p role="status" className="text-sm text-steel">Using the last saved product details on this device. Changes still require server confirmation.</p>}
  {error&&<p role="alert" className="text-sm text-error">{error}</p>}{!data?<p role="status">Loading editable details…</p>:<DataTable columns={columns} rows={tableRows} idKey="id" editable onSave={()=>void save()} searchPlaceholder="Find a product to edit…"/>}
 </div>;
}
