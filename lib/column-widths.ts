// Semantic column names share a width across every list and entry grid.
export function columnWidthKey(key: string): string {
  if (key.trim() === "#") return "serial";
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
  const groups = [
    ["serial", "sno", "row", "rownumber"],
    ["quantity", "qty"],
    ["unitprice", "price", "salesrate"],
    ["ratelist", "listprice", "unitcost", "rate1", "rate2", "rate3", "purchaserate1", "purchaserate2", "purchaserate3", "cost"],
    ["total", "grandtotal", "linetotal"],
    ["paid", "paidamount"],
    ["item", "itemname", "product", "productname", "name"],
    ["contact", "customer", "supplier", "party", "displayname"],
    ["date", "documentdate", "paymentdate"],
    ["channel", "saletype"],
  ];
  return groups.find((group) => group.includes(normalized))?.[0] ?? normalized;
}

export function fittedColumnWidth(headerWidth: number, contentWidths: number[], minimum = 80): number {
  return Math.ceil(Math.max(minimum, headerWidth + 52, ...contentWidths.map((width) => width + 40)));
}
