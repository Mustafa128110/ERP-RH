// Next templates remount for each route segment. This makes the short visual
// acknowledgement apply to real route changes without inventing a delay or
// retaining stale form/list state across unrelated screens.
export default function DashboardTemplate({ children }: { children: React.ReactNode }) {
  return <div className="route-transition flex h-full min-h-0 flex-col">{children}</div>;
}
