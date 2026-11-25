// Proportional semantic column widths with a fixed breathable gutter so
// neighbouring columns and texts never collide.
export const TABLE_COLUMN_GUTTER = 16;

export function columnWidthKey(key: string): string {
  if (key.trim() === "#") return "serial";
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
  const groups = [
    ["serial", "sno", "row", "rownumber"],
    ["select", "selection"],
    ["quantity", "qty"],
    ["unitprice", "price", "salesrate"],
    ["ratelist", "listprice", "unitcost", "rate1", "rate2", "rate3", "purchaserate1", "purchaserate2", "purchaserate3", "cost", "linetotal"],
    ["total", "grandtotal"],
    ["paid", "paidamount"],
    ["item", "itemname", "product", "productname", "name"],
    ["contact", "customer", "supplier", "party", "displayname"],
    ["date", "documentdate", "paymentdate", "validuntil", "closed"],
    ["channel", "saletype"],
    ["count", "entries", "documents", "items", "products", "users", "permissions", "lines"],
    ["description", "summary", "notes", "note", "reason", "address", "roles", "inputs", "outputs"],
  ];
  return groups.find((group) => group.includes(normalized))?.[0] ?? normalized;
}

export function columnContentKind(key: string, align?: "left" | "right"): "text" | "number" | "date" {
  const canonical = columnWidthKey(key);
  if (
    canonical === "serial" ||
    align === "right" ||
    /^(quantity|unitprice|ratelist|total|paid|balance|amount|debit|credit|onhand|valuation|stock|revenue|grossprofit|netprofit|profit|expenses|adjustments|count|age|available|opening|closing|tax|discount|shipping|net|targetqty|costshare|multiplier|creditlimit|creditbalance|debtbalance|rate\d*)$/.test(
      canonical,
    )
  ) {
    return "number";
  }
  if (/date|createdat|updatedat|closedat|timestamp|^when$|^month$|^period$/.test(canonical)) return "date";
  return "text";
}

export function minimumColumnWidth(key: string, align?: "left" | "right"): number {
  const canonical = columnWidthKey(key);
  if (canonical === "select") return 48;
  if (canonical === "serial") return 64;
  if (canonical === "remove") return 52;
  if (["pdf", "png", "download"].includes(canonical)) return 80;
  if (["actions", "action", "return"].includes(canonical)) return 96;
  if (canonical === "setup") return 84;
  if (canonical === "age") return 80;
  if (canonical === "count") return 104;
  if (["taxable", "isactive", "active", "marketbuy", "marketpurchase"].includes(canonical)) return 96;
  if (canonical === "quantity" || canonical === "net" || canonical === "basequantity" || canonical === "targetqty" || canonical === "costshare" || canonical === "multiplier") return 104;
  if (canonical === "unit") return 104;
  if (canonical === "onhand" || canonical === "available") return 132;
  if (canonical === "unitprice" || canonical === "ratelist") return 132;
  if (columnContentKind(key, align) === "number") return 152;
  if (columnContentKind(key, align) === "date") return /time|created|updated|^when$/.test(canonical) ? 184 : 124;
  if (canonical === "status" || canonical === "type") return 136;
  if (["company", "channel", "number", "sku", "code", "mode"].includes(canonical)) return 128;
  if (canonical === "item" || canonical === "contact") return 220;
  if (canonical === "description") return 240;
  if (/accountnumber|iban/.test(canonical)) return 208;
  if (canonical === "email" || canonical === "bankaccount" || canonical === "companyname") return 184;
  return 148;
}

export function fixedColumnMinimum(column: { key: string; align?: "left" | "right"; width?: string | number }): number {
  if (typeof column.width === "number" && column.width > 0) {
    return Math.max(48, column.width);
  }
  return minimumColumnWidth(column.key, column.align);
}

export function columnGrowWeight(key: string): number {
  const canonical = columnWidthKey(key);
  if (
    [
      "serial",
      "select",
      "actions",
      "action",
      "remove",
      "pdf",
      "png",
      "download",
      "return",
      "marketbuy",
      "marketpurchase",
      "setup",
      "unitrules",
      "basequantity",
      "unit",
      "status",
      "type",
      "taxable",
      "isactive",
      "active",
      "company",
      "number",
      "sku",
      "code",
      "mode",
    ].includes(canonical) ||
    columnContentKind(key) !== "text"
  ) {
    return 0;
  }
  if (canonical === "item" || canonical === "contact") return 3;
  if (canonical === "description") return 4;
  if (canonical === "channel") return 0.5;
  return 1;
}

// Only text columns share spare viewport width; figures, dates, and compact badges stay fixed.
export function createColumnLayout(columns: { key: string; minimum: number; grow?: number }[], availableWidth = 0) {
  const minimumWidth = columns.reduce((sum, column) => sum + column.minimum, 0);
  let weights = columns.map((column) => column.grow ?? columnGrowWeight(column.key));
  if (!weights.some(Boolean)) {
    weights = columns.map((column) =>
      columnWidthKey(column.key) === "serial" || columnWidthKey(column.key) === "select" ? 0 : 1,
    );
  }
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  const shares = weights.map((weight) => (totalWeight ? weight / totalWeight : 0));
  const tableWidth = Math.max(minimumWidth, availableWidth);
  return {
    minimumWidth,
    tableWidth,
    shares,
    widths: columns.map((column, index) => `${column.minimum + (tableWidth - minimumWidth) * shares[index]}px`),
  };
}
