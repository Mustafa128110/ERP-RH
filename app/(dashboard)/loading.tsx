// Sits directly under (dashboard)/layout.tsx, so it replaces only the <main>
// content — the sidebar and topbar stay put. Without a boundary here every
// navigation held the *old* page on screen until the new one's queries finished,
// which is what made the app feel frozen rather than slow.
export default function Loading() {
  return (
    <div className="flex animate-pulse flex-col gap-4">
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-2">
          <div className="h-6 w-48 rounded bg-zinc-200 dark:bg-zinc-800" />
          <div className="h-4 w-32 rounded bg-zinc-100 dark:bg-zinc-900" />
        </div>
        <div className="h-9 w-28 rounded-md bg-zinc-200 dark:bg-zinc-800" />
      </div>

      <div className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
        <div className="h-10 border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/60" />
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="flex items-center gap-4 border-b border-zinc-100 px-4 py-3 last:border-0 dark:border-zinc-800/60">
            <div className="h-4 flex-1 rounded bg-zinc-100 dark:bg-zinc-900" />
            <div className="h-4 w-1/4 rounded bg-zinc-100 dark:bg-zinc-900" />
            <div className="h-4 w-16 rounded bg-zinc-100 dark:bg-zinc-900" />
          </div>
        ))}
      </div>
    </div>
  );
}
