"use client";
import {useState} from "react";
import {useRouter} from "next/navigation";
import {type listStockConversions,type getConversionOptions} from "@/lib/client-actions/stock-conversions";
import {ConversionEntry} from "./ConversionEntry";
import {FormRecovery} from "@/components/ui/FormRecovery";
import {Dialog} from "@/components/ui/Dialog";
import {DataTable} from "@/components/ui/DataTable";
import {PageHeader} from "@/components/ui/PageHeader";
import {useNewEntry} from "@/components/layout/KeyboardShortcuts";
import {money,formatDate} from "@/lib/format";
import type {ColumnDef} from "@/lib/table";
type Options=Awaited<ReturnType<typeof getConversionOptions>>;
const columns:ColumnDef[]=[{key:"number",label:"Number"},{key:"date",label:"Date"},{key:"channel",label:"Channel"},{key:"location",label:"Warehouse"},{key:"inputs",label:"Consumed"},{key:"outputs",label:"Produced"},{key:"cost",label:"Transferred Cost",align:"right"},{key:"note",label:"Note"}];
export function StockConversionManager({rows,options}:{rows:Awaited<ReturnType<typeof listStockConversions>>;options:Options}){
 const [open,setOpen]=useState(false);const router=useRouter();useNewEntry(()=>setOpen(true));
 return <div className="flex h-full flex-col gap-3"><PageHeader title="Stock Conversions" subtitle="Purchased products consumed into other products; quantities and recorded value are tracked together."><button type="button" onClick={()=>setOpen(true)} className="rounded bg-navy-800 px-3 py-2 text-sm text-white">New conversion</button></PageHeader><DataTable columns={columns} rows={rows.map(row=>({...row,date:formatDate(row.date),cost:money(row.cost)}))} idKey="id" searchPlaceholder="Search conversions…" emptyMessage="No stock conversions posted yet."/>{open&&<Dialog title="Convert Stock into Products" onClose={()=>setOpen(false)} size="xwide"><FormRecovery domain="documents" id="stock-conversion" revision="0" createAction="stock-conversions.createStockConversion"><ConversionEntry options={options} onDone={()=>{setOpen(false);router.refresh();}}/></FormRecovery></Dialog>}</div>;
}
