// Fixed semantic widths. Record contents never change column geometry.
export const TABLE_COLUMN_GUTTER = 12;
export function columnWidthKey(key: string): string {
  if (key.trim() === "#") return "serial";
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
  const groups = [
    ["serial", "sno", "row", "rownumber"],
    ["select", "selection"],
    ["quantity", "qty"],
    ["unitprice", "price", "salesrate"],
    ["ratelist", "listprice", "unitcost", "rate1", "rate2", "rate3", "purchaserate1", "purchaserate2", "purchaserate3", "cost"],
    ["total", "grandtotal", "linetotal"],
    ["paid", "paidamount"],
    ["item", "itemname", "product", "productname", "name"],
    ["contact", "customer", "supplier", "party", "displayname"],
    ["date", "documentdate", "paymentdate"],
    ["channel", "saletype"],
    ["count", "entries", "documents"],
    ["description", "summary", "notes", "note", "reason", "address"],
  ];
  return groups.find((group) => group.includes(normalized))?.[0] ?? normalized;
}

export function minimumColumnWidth(key: string): number {
  const canonical = columnWidthKey(key);
  if (canonical === "select") return 48;
  if (["serial", "actions", "action", "remove", "pdf", "png", "download", "setup", "unitrules", "basequantity"].includes(canonical)) return 64;
  if (canonical === "age") return 96;
  if (canonical === "count") return 160;
  if (["return", "marketbuy", "marketpurchase"].includes(canonical)) return 96;
  if (columnContentKind(key) === "number") return 256;
  if (columnContentKind(key) === "date") return /time|created|updated/.test(canonical) ? 208 : 144;
  if (canonical === "item" || canonical === "contact") return 320;
  if (canonical === "description") return 320;
  if (canonical === "unit") return 112;
  if (canonical === "status") return 144;
  if (/accountnumber|iban/.test(canonical)) return 320;
  return 176;
}

export function columnContentKind(key: string, align?: "left" | "right"): "text" | "number" | "date" {
  const canonical = columnWidthKey(key);
  if (canonical === "serial" || align === "right" || /^(quantity|unitprice|ratelist|total|paid|balance|amount|debit|credit|onhand|valuation|stock|revenue|cost|grossprofit|netprofit|profit|expenses|adjustments|entries|count|age|available|opening|closing|tax|discount|shipping|rate\d*)$/.test(canonical)) return "number";
  if (/date|createdat|updatedat|closedat|timestamp|^month$|^period$/.test(canonical)) return "date";
  return "text";
}

export function fixedColumnMinimum(column: {key: string; align?: "left" | "right"; width?: string | number}): number {
  const compact = ["serial", "age", "count"].includes(columnWidthKey(column.key));
  const semantic = columnContentKind(column.key, column.align) === "number" && !compact ? 256 : minimumColumnWidth(column.key);
  return Math.max(semantic, typeof column.width === "number" ? column.width : 0);
}

export function columnGrowWeight(key: string): number {
  const canonical = columnWidthKey(key);
  if (["serial", "select", "actions", "action", "remove", "pdf", "png", "download", "return", "marketbuy", "marketpurchase", "setup", "unitrules", "basequantity", "unit", "status"].includes(canonical) || columnContentKind(key) !== "text") return 0;
  if (canonical === "item" || canonical === "contact") return 3;
  if (canonical === "description") return 4;
  return 1;
}

// Only text columns share spare viewport width; figures and dates stay fixed.
export function createColumnLayout(columns: {key: string; minimum: number; grow?: number}[], availableWidth = 0) {
  const minimumWidth = columns.reduce((sum, column) => sum + column.minimum, 0);
  let weights = columns.map(column => column.grow ?? columnGrowWeight(column.key));
  if (!weights.some(Boolean)) weights = columns.map(column => columnWidthKey(column.key) === "serial" || columnWidthKey(column.key) === "select" ? 0 : 1);
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  const shares = weights.map(weight => totalWeight ? weight / totalWeight : 0);
  const tableWidth = Math.max(minimumWidth, availableWidth);
  return {
    minimumWidth,
    tableWidth,
    shares,
    widths: columns.map((column, index) => `${column.minimum + (tableWidth - minimumWidth) * shares[index]}px`),
  };
}
