"use client";
import {createContext,useContext,useRef,useEffect,useState,useTransition,type ReactNode} from "react";
import {useRouter,usePathname,useSearchParams} from "next/navigation";
import type {HistoryInfo} from "@/lib/history-window";
type Context={info:HistoryInfo;pending:boolean;change:(values:Record<string,string|number|null>,debounce?:boolean)=>void};
const History=createContext<Context|null>(null);
export function HistoryProvider({info,children}:{info:HistoryInfo;children:ReactNode}){
 const router=useRouter(),path=usePathname(),params=useSearchParams();
 const [pending,start]=useTransition();const timer=useRef<ReturnType<typeof setTimeout>|null>(null);
 const requested=useRef<Record<string,string|number|null>>({});
 useEffect(()=>{
  if(Object.entries(requested.current).every(([key,value])=>(params.get(key)??"")===String(value??""))) requested.current={};
 },[params]);
 useEffect(()=>()=>{if(timer.current)clearTimeout(timer.current)},[]);
 function change(values:Record<string,string|number|null>,debounce=false){
  requested.current={...requested.current,...values};
  if(timer.current)clearTimeout(timer.current);
  const send=()=>{
   const next=new URLSearchParams(params.toString());
   for(const [key,value] of Object.entries(requested.current)){if(value===null||value==="")next.delete(key);else next.set(key,String(value))}
   start(()=>router.replace(`${path}?${next}`,{scroll:false}));
  };
  if(debounce)timer.current=setTimeout(send,180);else send();
 }
 return <History.Provider value={{info,pending,change}}>{children}</History.Provider>;
}
export const useHistory=()=>useContext(History);
export function HistoryControls({sortOptions=[]}:{sortOptions?:{key:string;label:string}[]}){
 const history=useHistory();
 const [query,setQuery]=useState(history?.info.query??'');
 const [seen,setSeen]=useState(history?.info.query??'');
 if(history&&seen!==history.info.query){if(query===seen)setQuery(history.info.query);setSeen(history.info.query);}
 if(!history)return null;
 return <div className="flex flex-wrap items-center gap-3 print:hidden"><input type="search" aria-label="Search full history" value={query} placeholder="Search full history…" onChange={event=>{setQuery(event.target.value);history.change({q:event.target.value,page:1},true);}} className="rounded border border-sand p-2 text-sm"/>{sortOptions.length>0&&<><select aria-label="Sort history by" value={history.info.sort} onChange={event=>history.change({sort:event.target.value,page:1})} className="rounded border border-sand p-2 text-sm"><option value="">Default order</option>{sortOptions.map(option=><option key={option.key} value={option.key}>{option.label}</option>)}</select><button type="button" onClick={()=>history.change({order:history.info.direction==='asc'?'desc':'asc',page:1})}>{history.info.direction==='asc'?'Ascending':'Descending'}</button></>}<HistoryPager history={history}/></div>;
}
export function HistoryPager({history}:{history:Context}){
 const {info,pending,change}=history;
 return <div className="flex flex-wrap items-center gap-3 text-sm text-steel print:hidden" aria-busy={pending}>
  <span>{pending?"Loading…":info.recordTotal!==undefined&&info.recordTotal!==info.total?`${info.recordTotal.toLocaleString()} matching records in ${info.total.toLocaleString()} groups`:`${info.total.toLocaleString()} matching records`}{!info.all&&` · Page ${info.page} of ${Math.max(1,Math.ceil(info.total/info.pageSize))}`}</span>
  {!info.all&&<><button type="button" disabled={pending||info.page<=1} onClick={()=>change({page:info.page-1})}>Previous</button><button type="button" disabled={pending||info.page*info.pageSize>=info.total} onClick={()=>change({page:info.page+1})}>Next</button></>}
  <button type="button" disabled={pending} onClick={()=>change({all:info.all?null:"1",page:1})}>{info.all?"Use pages":"Load all matches for print or export"}</button>
 </div>;
}
