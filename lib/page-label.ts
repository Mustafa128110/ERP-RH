import { navSections } from "@/lib/nav-config";

const staticLabels = new Map(
  navSections.flatMap((section) => section.items.map((item) => [item.href, item.label] as const)),
);

const detailLabels: Array<{ matches: (pathname: string) => boolean; label: string }> = [
  { matches: (pathname) => /^\/sales\/invoices\/[^/]+$/.test(pathname), label: "Invoice" },
  { matches: (pathname) => /^\/sales\/quotations\/[^/]+$/.test(pathname), label: "Quotation" },
  { matches: (pathname) => /^\/sales\/[^/]+$/.test(pathname), label: "Edit Sale" },
  { matches: (pathname) => /^\/inventory\/stock-transfers\/[^/]+$/.test(pathname), label: "Stock Transfer" },
  { matches: (pathname) => /^\/inventory\/inter-company\/[^/]+$/.test(pathname), label: "Inter-Company Sale" },
  { matches: (pathname) => /^\/inventory\/stock-adjustments\/[^/]+$/.test(pathname), label: "Stock Adjustment" },
  { matches: (pathname) => /^\/reports\/[^/]+$/.test(pathname), label: "Report" },
];

const additionalLabels = new Map([
  ["/login", "Login"],
  ["/settings/backups", "Backups"],
  ["/purchases/suppliers", "Suppliers"],
  ["/sales/new", "New Sale"],
]);

// This is intentionally one name only. The dashboard is the app home; every
// other browser tab label describes the page the person is actually using.
export function pageLabel(pathname: string) {
  if (pathname === "/dashboard") return "ERP RH";

  return staticLabels.get(pathname) ?? additionalLabels.get(pathname) ?? detailLabels.find((item) => item.matches(pathname))?.label ?? "Page";
}
