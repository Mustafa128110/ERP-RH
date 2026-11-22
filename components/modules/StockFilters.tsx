"use client";

import { useChannels } from "@/components/layout/ChannelProvider";
import { setScopeChannel } from "@/lib/actions/channels";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

// One select per query param. The stock page filters by company and by location,
// and the only thing that differs between the two is the param name, the "all"
// label, and whether there's a sentinel option (location has "unassigned").
export function StockFilter({
  param,
  allLabel,
  options,
  extraOption,
}: {
  param: string;
  allLabel: string;
  options: { id: string; name: string }[];
  extraOption?: { value: string; label: string };
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { channels, selected } = useChannels();
  const current = searchParams.get(param) ?? "";
  if (param === "company") return <select aria-label="Channel filter" value={selected} onChange={async (event) => { const result = await setScopeChannel(event.target.value); if (!result.error) router.refresh(); }} className="h-10 rounded border border-sand px-3 text-sm"><option value="all">All channels</option>{channels.map((channel) => <option key={channel.id} value={channel.id}>{channel.name}</option>)}</select>;

  function onChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const value = e.target.value;
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(param, value);
    else params.delete(param);
    router.push(params.size > 0 ? `${pathname}?${params.toString()}` : pathname);
  }

  return (
    <select
      value={current}
      onChange={onChange}
      className="h-11 w-full rounded-md border border-sand bg-transparent px-3 text-base text-ink sm:h-10 sm:w-auto sm:text-sm"
    >
      <option value="">{allLabel}</option>
      {extraOption && <option value={extraOption.value}>{extraOption.label}</option>}
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.name}
        </option>
      ))}
    </select>
  );
}
