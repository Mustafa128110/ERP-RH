"use client";
import {getClientUserId} from "./client-user";
const eventName="erp:server-change",key="erp:server-change";
let channel:BroadcastChannel|undefined;
export function announceServerChange(){
 const message={userId:getClientUserId(),id:crypto.randomUUID()};
 window.dispatchEvent(new CustomEvent(eventName,{detail:message}));
 if(typeof BroadcastChannel!=="undefined"){channel??=new BroadcastChannel(eventName);channel.postMessage(message);}
 try{localStorage.setItem(key,JSON.stringify(message));}catch{/* BroadcastChannel still works when localStorage is blocked. */}
}
export function subscribeServerChanges(listener:()=>void){
 const seen=new Set<string>();
 const accept=(value:unknown)=>{if(!value||typeof value!=="object")return;const message=value as {userId?:string;id?:string};if(message.userId!==getClientUserId()||!message.id||seen.has(message.id))return;seen.add(message.id);if(seen.size>128)seen.delete(seen.values().next().value!);listener();};
 const local=(event:Event)=>accept((event as CustomEvent).detail);
 const storage=(event:StorageEvent)=>{if(event.key===key&&event.newValue){try{accept(JSON.parse(event.newValue));}catch{/* Invalid messages carry no state. */}}};
 const other=typeof BroadcastChannel!=="undefined"?new BroadcastChannel(eventName):null;
 if(other)other.onmessage=event=>accept(event.data);
 window.addEventListener(eventName,local);window.addEventListener("storage",storage);
 return()=>{other?.close();window.removeEventListener(eventName,local);window.removeEventListener("storage",storage);};
}
