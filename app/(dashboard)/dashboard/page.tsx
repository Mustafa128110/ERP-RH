import { getDashboardData, getDashboardCompanies } from "@/lib/actions/dashboard";
import { StatCard } from "@/components/ui/StatCard";
import { formatDate, money as rupees, qty } from "@/lib/format";

// Dashboard tiles carry the currency; every other screen shows bare numbers.
const money = (n: number) => `PKR ${rupees(n)}`;

export const dynamic = "force-dynamic";



export default async function DashboardPage() {
  const [data, companyRows] = await Promise.all([getDashboardData(), getDashboardCompanies()]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">Dashboard</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          {companyRows.map((c) => c.name).join(" + ") || "No companies"} · {formatDate(data.today)}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        <StatCard label="Today's Sales" value={money(data.todaySales)} />
        <StatCard label="Today's Purchases" value={money(data.todayPurchases)} />
        <StatCard label="Today's Expenses" value={money(data.todayExpenses)} />
        <StatCard label="Cash Position" value={money(data.cashPosition)} hint="bank + cash accounts" />
        <StatCard label="Inventory Value" value={money(data.inventoryValue)} hint="on hand at average cost" />
        <StatCard label="Outstanding Receivables" value={money(data.receivables)} hint="unpaid on sales invoices" />
        <StatCard label="Outstanding Payables" value={money(data.payables)} hint="unpaid on purchase invoices" />
        <StatCard label="Out of Stock" value={`${data.outOfStock} product${data.outOfStock === 1 ? "" : "s"}`} hint="nothing on hand anywhere" />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="mb-3 text-sm font-semibold text-zinc-900 dark:text-zinc-50">Top Products</h2>
          {data.topProducts.length === 0 ? (
            <p className="py-2 text-sm text-zinc-500 dark:text-zinc-400">Nothing sold yet.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-zinc-100 dark:divide-zinc-800">
              {data.topProducts.map((p) => (
                <li key={p.name} className="flex items-center justify-between gap-4 py-2 text-sm">
                  <span className="truncate text-zinc-800 dark:text-zinc-200">{p.name}</span>
                  <span className="shrink-0 tabular-nums text-zinc-500 dark:text-zinc-400">
                    {qty(p.unitsSold)} {p.unit || "units"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="mb-3 text-sm font-semibold text-zinc-900 dark:text-zinc-50">Warehouse Summary</h2>
          {data.warehouses.length === 0 ? (
            <p className="py-2 text-sm text-zinc-500 dark:text-zinc-400">No stock recorded yet.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-zinc-100 dark:divide-zinc-800">
              {data.warehouses.map((w) => (
                <li key={w.name} className="flex items-center justify-between gap-4 py-2 text-sm">
                  <span className="truncate text-zinc-800 dark:text-zinc-200">{w.name}</span>
                  <div className="flex shrink-0 items-center gap-3">
                    {w.outOfStock > 0 && <span className="text-xs text-zinc-500 dark:text-zinc-400">{w.outOfStock} out</span>}
                    <span className="tabular-nums text-zinc-700 dark:text-zinc-300">{money(w.value)}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
