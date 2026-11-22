"use client";

import { useState, useTransition } from "react";
import { useChannels } from "@/components/layout/ChannelProvider";
import { saveChannel, setChannelActive } from "@/lib/actions/channels";

export function ChannelManager() {
  const { channels } = useChannels();
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  const [name, setName] = useState("");

  function run(work: () => Promise<{ error?: string; success?: boolean }>) {
    start(async () => {
      try {
        const result = await work();
        setError(result.error ?? "");
        if (!result.error) setName("");
      } catch {
        setError("Could not confirm the channel update. Refresh Settings before retrying.");
      }
    });
  }

  return (
    <section className="rounded-lg border border-sand bg-white p-5">
      <h2 className="mb-3 text-sm font-semibold text-navy-800">Sales channels</h2>
      <p className="mb-3 text-xs text-steel">
        Shared by sales, purchases and payments. Removing a channel preserves its history.
      </p>
      <div className="flex flex-col gap-2">
        {channels.map((channel) => (
          <form
            key={channel.id}
            onSubmit={(event) => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              run(() => saveChannel(channel.id, String(data.get("name"))));
            }}
            className="flex flex-wrap items-center gap-2"
          >
            <input name="name" aria-label="Channel name" defaultValue={channel.name} required maxLength={100}
              className="min-w-0 flex-1 rounded border border-sand px-2 py-2 text-sm" />
            <button disabled={pending} className="text-xs text-navy-800">Save</button>
            <button type="button" disabled={pending}
              onClick={() => run(() => setChannelActive(channel.id, !channel.isActive))}
              className="text-xs text-error">
              {channel.isActive ? "Remove" : "Restore"}
            </button>
          </form>
        ))}
      </div>
      <form onSubmit={(event) => { event.preventDefault(); run(() => saveChannel(null, name)); }} className="mt-4 flex gap-2">
        <input value={name} onChange={(event) => setName(event.target.value)} required maxLength={100}
          placeholder="New channel" aria-label="New channel name"
          className="min-w-0 flex-1 rounded border border-sand px-2 py-2 text-sm" />
        <button disabled={pending} className="rounded border border-sand px-3 text-sm">Add</button>
      </form>
      {error && <p role="alert" className="mt-2 text-sm text-error">{error}</p>}
    </section>
  );
}
