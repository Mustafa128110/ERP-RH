"use client";
import {useSyncExternalStore} from "react";
import {getClientUserId,useClientUserId} from "./client-user";
import type {SavedCommand} from "./command-protocol";
const empty:SavedCommand[]=[];
let owner:string|null=null,snapshot:SavedCommand[]=empty,signature="";
const listeners=new Set<()=>void>();
export function publishLocalCommands(userId:string,commands:SavedCommand[]){
 const next=commands.map(row=>`${row.id}:${row.status}:${row.updatedAt}`).join("|");
 if(owner===userId&&signature===next)return;
 owner=userId;signature=next;snapshot=commands;
 for(const listener of listeners)listener();
}
export function publishLocalCommand(command:SavedCommand){
 if(command.userId!==getClientUserId())return;
 const rows=owner===command.userId?snapshot:empty;
 publishLocalCommands(command.userId,[...rows.filter(row=>row.id!==command.id),command].sort((a,b)=>a.createdAt-b.createdAt||a.id.localeCompare(b.id)));
}
export function useLocalCommands(){
 useClientUserId();
 return useSyncExternalStore(listener=>{listeners.add(listener);return()=>listeners.delete(listener);},()=>owner===getClientUserId()?snapshot:empty,()=>empty);
}
