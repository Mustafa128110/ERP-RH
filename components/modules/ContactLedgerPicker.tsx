"use client";
import {useRouter} from "next/navigation";
import {useEffect,useRef,useState,useTransition} from "react";
import {useChannels} from "@/components/layout/ChannelProvider";
import {Dialog} from "@/components/ui/Dialog";
import {DataTable} from "@/components/ui/DataTable";
import {PartyLedgerDialog} from "@/components/modules/PartyLedgerDialog";
import {listContactLedgers,createContactLedger,mergeContactLedgers,closeContactLedger} from "@/lib/client-actions/ledger-channels";
import {money,formatDate} from "@/lib/format";
import type {ColumnDef} from "@/lib/table";
type Ledger=Awaited<ReturnType<typeof listContactLedgers>>[number];
type Props={companyId:string;contactId:string;contactName:string;onClose:()=>void;onExport:Parameters<typeof PartyLedgerDialog>[0]["onExport"]};
export function ContactLedgerPicker(props:Props){
 const router=useRouter();
 const {channels}=useChannels();
 const [ledgers,setLedgers]=useState<Ledger[]>([]),[opened,setOpened]=useState<Ledger|null>(null),[error,setError]=useState("");
 const [pending,start]=useTransition(),[loading,setLoading]=useState(true);
 const [newChannel,setNewChannel]=useState(""),[merging,setMerging]=useState(false),[sources,setSources]=useState<string[]>([]),[target,setTarget]=useState("");
 const operation=useRef<string>(crypto.randomUUID());
 async function refresh(){setLedgers(await listContactLedgers(props.companyId,props.contactId));}
 useEffect(()=>{let active=true;listContactLedgers(props.companyId,props.contactId).then(rows=>{if(active)setLedgers(rows);}).catch(()=>{if(active)setError("Couldn't load this contact's ledgers.");}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[props.companyId,props.contactId]);
 function run(work:()=>Promise<{error?:string;success?:boolean}>){start(async()=>{setError("");try{const result=await work();if(result.error){setError(result.error);return;}operation.current=crypto.randomUUID();await refresh();router.refresh();}catch{setError("Could not confirm the update. Your selections are preserved; retry to check the same operation.");}});}
 if(opened)return <PartyLedgerDialog {...props} channelId={opened.channelId} channelName={opened.name} onClose={()=>{setOpened(null);void refresh().catch(()=>setError("Refresh to see the latest balances."));}} />;
 const columns:ColumnDef[]=[{key:"name",label:"Ledger / Channel"},{key:"balance",label:"Balance",align:"right"},{key:"entries",label:"Entries",align:"right"},{key:"closed",label:"Last Closed"},{key:"actions",label:"Actions",render:row=><button type="button" disabled={pending} onClick={event=>{event.stopPropagation();if(confirm(`Close ${row.name} to zero? The balance is posted as a write-off / adjustment. All history is retained; no cash or bank money moves.`))run(()=>closeContactLedger({companyId:props.companyId,contactId:props.contactId,channelId:String(row.id),operationId:operation.current}));}} className="rounded border border-sand px-2 py-1 text-xs">Close to zero</button>}];
 return <Dialog title={`${props.contactName} · Ledgers`} onClose={props.onClose} size="xwide"><div className="flex flex-col gap-4">
  <p className="text-sm text-steel">Choose the channel ledger to open. Closing retains the past entries; future transactions use the same ledger. Correct a closed period with a new balance adjustment.</p>
  <div className="flex flex-wrap items-center gap-2"><select aria-label="New ledger channel" value={newChannel} onChange={event=>setNewChannel(event.target.value)} className="rounded border border-sand p-2 text-sm"><option value="">Choose a channel</option>{channels.filter(channel=>channel.isActive).map(channel=><option key={channel.id} value={channel.id}>{channel.name}</option>)}</select><button type="button" disabled={!newChannel||pending} onClick={()=>run(()=>createContactLedger(props.companyId,props.contactId,newChannel,operation.current))} className="rounded border border-sand px-3 py-2 text-sm">Add ledger</button><button type="button" onClick={()=>setMerging(value=>!value)} className="rounded border border-sand px-3 py-2 text-sm">Merge ledgers</button></div>
  {loading?<p>Loading ledgers…</p>:<DataTable columns={columns} rows={ledgers.map(ledger=>({id:ledger.channelId,name:ledger.name,balance:money(ledger.balance),entries:ledger.entries,closed:ledger.closedAt?formatDate(ledger.closedAt.slice(0,10)):"—"}))} idKey="id" onRowClick={row=>setOpened(ledgers.find(ledger=>ledger.channelId===row.id)??null)} searchPlaceholder="Find a ledger…" emptyMessage="No ledger yet. Choose a channel to add one." globalShortcuts={false}/>}
  {merging&&<section className="flex flex-col gap-3 rounded border border-sand p-3"><p className="font-medium text-sm">Merge this contact&apos;s complete ledgers</p><p className="text-xs text-steel">Choose source ledgers and a destination. Every transaction moves together; history and payment allocations are retained.</p><div className="flex flex-wrap gap-3">{ledgers.map(ledger=><label key={ledger.channelId} className="flex gap-2 text-sm"><input type="checkbox" checked={sources.includes(ledger.channelId)} disabled={ledger.channelId===target||pending} onChange={event=>setSources(current=>event.target.checked?[...current,ledger.channelId]:current.filter(value=>value!==ledger.channelId))}/>{ledger.name}</label>)}</div><div className="flex flex-wrap gap-2"><select aria-label="Destination ledger" disabled={pending} value={target} onChange={event=>{setTarget(event.target.value);setSources(current=>current.filter(value=>value!==event.target.value));}} className="rounded border border-sand p-2 text-sm"><option value="">Destination ledger</option>{channels.filter(channel=>channel.isActive).map(channel=><option key={channel.id} value={channel.id}>{channel.name}</option>)}</select></div>
  <button type="button" disabled={!sources.length||!target||pending} onClick={()=>{if(confirm("Merge the complete source ledgers into the destination? Every transaction moves and no history is deleted."))run(()=>mergeContactLedgers({companyId:props.companyId,contactId:props.contactId,sourceChannels:sources,targetChannel:target,operationId:operation.current}));}} className="self-start rounded bg-navy-800 px-4 py-2 text-sm text-white disabled:opacity-40">{pending?"Saving…":"Merge complete ledgers"}</button></section>}
  {error&&<p role="alert" className="text-sm text-error">{error}</p>}
 </div></Dialog>;
}
