"use client";
import Link from "next/link";
import {useRouter} from "next/navigation";
import {DataTable} from "@/components/ui/DataTable";
import {PageHeader} from "@/components/ui/PageHeader";
import {WorkspaceControls} from "@/components/layout/TableWorkspace";
import {money,formatDate} from "@/lib/format";
import {toCsv} from "@/lib/csv";
import type {ProfitCalendar as Calendar} from "@/lib/queries/profit-calendar";
import type {ColumnDef} from "@/lib/table";
const values=[{key:"revenue",label:"Net Sales"},{key:"cost",label:"Cost at Sale"},{key:"grossProfit",label:"Gross Profit"},{key:"expenses",label:"Expenses"},{key:"adjustments",label:"Ledger Adjustments"},{key:"netProfit",label:"Net Profit"}];
export function ProfitCalendar({data}:{data:Calendar}) {
 const router=useRouter();
 const records=data.month?data.days:data.months;
 const columns:ColumnDef[]=[{key:"period",label:data.month?"Date":"Month"},...values.map(value=>({...value,align:"right" as const})),{key:"documents",label:"Sales / Returns",align:"right"}];
 const rows=records.map(record=>({id:record.period,...record,period:data.month?formatDate(record.period):record.period,...Object.fromEntries(values.map(value=>[value.key,money(record[value.key as keyof typeof record])]))}));
 function exportCsv(){const text=toCsv([[data.month?"Date":"Month",...values.map(value=>value.label),"Sales / Returns"],...records.map(record=>[record.period,...values.map(value=>String(record[value.key as keyof typeof record])),String(record.documents)])]);const url=URL.createObjectURL(new Blob(["\uFEFF"+text],{type:"text/csv;charset=utf-8"}));const link=document.createElement("a");link.href=url;link.download=`profit-${data.month??"months"}.csv`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 return <div className="flex h-full flex-col gap-3"><WorkspaceControls label="Report navigation"><Link href="/reports" className="text-sm text-steel">← Reports</Link></WorkspaceControls><PageHeader title={data.month?`Daily Profit · ${data.month}`:"Profit by Month"} subtitle="Recorded sale costs, returns and expenses; all historical months are available.">{data.month&&<Link href="/reports/profit" className="rounded border border-sand px-3 py-2 text-sm">All months</Link>}<Link href="/reports/profit?view=items" className="rounded border border-sand px-3 py-2 text-sm">By product</Link>{data.canExport&&<button type="button" onClick={exportCsv} className="rounded border border-sand px-3 py-2 text-sm">Export CSV</button>}</PageHeader><WorkspaceControls label="Report details"><p className="text-sm text-steel">Net sales exclude collected tax and include delivery income. Returns reduce sales and recorded cost on the return date. Net profit deducts posted expenses and includes ledger closing adjustments. Days without activity show zero.</p></WorkspaceControls><DataTable columns={columns} rows={rows} idKey="id" onRowClick={!data.month?row=>router.push(`/reports/profit?month=${row.id}`):undefined} searchPlaceholder={data.month?"Search dates…":"Search months…"} emptyMessage="No posted sales, returns or expenses yet."/></div>;
}
