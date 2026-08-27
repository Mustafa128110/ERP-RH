export function StatCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="min-w-0 overflow-hidden rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <p className="safe-wrap text-xs font-medium text-zinc-500 dark:text-zinc-400">{label}</p>
      <p className="numeric-contain safe-wrap mt-1 text-xl font-semibold text-zinc-900 sm:text-2xl dark:text-zinc-50">{value}</p>
      {hint && <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{hint}</p>}
    </div>
  );
}
