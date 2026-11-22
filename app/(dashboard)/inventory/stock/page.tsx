import { requireSession } from "@/lib/auth/session";
import { redirect } from "next/navigation";
import Link from "next/link";
import {StockConversionHistory} from "@/components/modules/StockConversionHistory";
import { StockCatalogue } from "@/components/modules/StockCatalogue";
import { StockTransferHistory } from "@/components/modules/StockTransferHistory";
import { StockAdjustmentHistory } from "@/components/modules/StockAdjustmentHistory";
export const dynamic = "force-dynamic";
export default async function Page({ searchParams }: { searchParams: Promise<Record<string,string|undefined>> }) {
  const params = await searchParams;
  const session = await requireSession();
  const allowed = new Set([...session.globalPermissions, ...[...session.permissionsByCompany.values()].flatMap((permissions) => [...permissions])]);
  const tabs = [
    { id: "catalogue", label: "Stock & Products", permissions: ["stock.view", "products.view"] },
    { id: "transfers", label: "Transfers", permissions: ["stock_transfers.view"] },
    { id: "conversions", label: "Conversions", permissions: ["stock.view", "stock_adjustments.view"] },
    { id: "adjustments", label: "Adjustments", permissions: ["stock_adjustments.view"] },
  ].filter((tab) => tab.permissions.some((permission) => allowed.has(permission)));
  if (!tabs.length) redirect("/dashboard");
  const view = tabs.some((tab) => tab.id === params.view) ? params.view : tabs[0].id;
  return <div className="flex h-full min-h-0 flex-col gap-3"><nav aria-label="Stock workspace" className="flex shrink-0 flex-wrap gap-2">{tabs.map(({id,label}) => <Link key={id} href={id === "catalogue" ? "/inventory/stock" : `/inventory/stock?view=${id}`} aria-current={view === id ? "page" : undefined} className={`rounded border px-4 py-2 text-sm ${view === id ? "border-navy-800 bg-navy-800 text-white" : "border-sand text-steel"}`}>{label}</Link>)}</nav><div className="min-h-0 flex-1">{view === "conversions" ? <StockConversionHistory /> : view === "transfers" ? <StockTransferHistory searchParams={Promise.resolve(params)} /> : view === "adjustments" ? <StockAdjustmentHistory searchParams={Promise.resolve(params)} /> : <StockCatalogue />}</div></div>;
}
