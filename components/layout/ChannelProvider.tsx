"use client";

import { createContext, useContext } from "react";
import { entryChannel } from "@/lib/sale-constants";

export type Channel = { id: string; name: string; isActive: boolean };
const Context = createContext<{ channels: Channel[]; selected: string }>({ channels: [], selected: "all" });
export const useChannels = () => useContext(Context);
export function ChannelProvider({ channels, selected, children }: { channels: Channel[]; selected: string; children: React.ReactNode }) {
  return <Context.Provider value={{ channels, selected }}>{children}</Context.Provider>;
}
export function ChannelField({ value, onChange, name = "saleType", className = "" }: { value?: string; onChange?: (value: string) => void; name?: string; className?: string }) {
  const { channels, selected } = useChannels();
  const initial = entryChannel(channels, selected);
  return <label className={`flex flex-col gap-1 text-sm ${className}`}><span className="text-xs font-medium text-steel">Channel</span><select name={name} required value={onChange ? value : undefined} defaultValue={onChange ? undefined : value ?? initial} onChange={onChange ? (event) => onChange(event.target.value) : undefined} className="h-11 rounded border border-sand bg-white px-3 text-ink">{channels.filter((channel) => channel.isActive || channel.id === value).map((channel) => <option key={channel.id} value={channel.id}>{channel.name}{channel.isActive ? "" : " (removed)"}</option>)}</select></label>;
}
