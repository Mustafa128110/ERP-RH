// Semantic column names share a width across every list and entry grid.
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
    ["description", "summary", "notes", "note", "reason", "address"],
  ];
  return groups.find((group) => group.includes(normalized))?.[0] ?? normalized;
}

export function minimumColumnWidth(key: string): number {
  const canonical = columnWidthKey(key);
  if (canonical === "select") return 48;
  if (["actions", "action", "remove", "pdf", "png", "download"].includes(canonical)) return 40;
  return 64;
}

export function columnGrowWeight(key: string): number {
  const canonical = columnWidthKey(key);
  if (["serial", "select", "actions", "action", "remove", "pdf", "png", "download", "return", "marketbuy", "marketpurchase"].includes(canonical)) return 0;
  if (canonical === "item" || canonical === "contact") return 5;
  if (canonical === "description") return 6;
  if (["date", "unit", "quantity", "status", "age"].includes(canonical)) return 0.75;
  if (["total", "paid", "balance", "amount", "debit", "credit", "unitprice", "ratelist"].includes(canonical)) return 1;
  return 2;
}

export function fittedColumnWidth(headerWidth: number, contentWidths: number[], minimum = 64): number {
  return Math.ceil(Math.max(minimum, headerWidth ? headerWidth + TABLE_COLUMN_GUTTER * 2 + 28 : 0, ...contentWidths.map((width) => width + TABLE_COLUMN_GUTTER * 2 + 8)));
}

// Keep expansion separate from measured minima. Fixed-layout HTML tables do not
// reliably resolve mixed percentage/length calc() widths on <col> elements.
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
