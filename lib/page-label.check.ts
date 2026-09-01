import assert from "node:assert/strict";
import { navSections } from "@/lib/nav-config";
import { pageLabel } from "@/lib/page-label";

for (const item of navSections.flatMap((section) => section.items)) {
  const expected = item.href === "/dashboard" ? "ERP RH" : item.label;
  assert.equal(pageLabel(item.href), expected, `${item.href} should use its page label`);
}

assert.equal(pageLabel("/login"), "Login");
assert.equal(pageLabel("/settings/backups"), "Backups");
assert.equal(pageLabel("/purchases/suppliers"), "Suppliers");
assert.equal(pageLabel("/sales/new"), "New Sale");
assert.equal(pageLabel("/sales/invoices/123"), "Invoice");
assert.equal(pageLabel("/sales/quotations/123"), "Quotation");
assert.equal(pageLabel("/sales/123"), "Edit Sale");
assert.equal(pageLabel("/inventory/stock-transfers/123"), "Stock Transfer");
assert.equal(pageLabel("/inventory/inter-company/123"), "Inter-Company Sale");
assert.equal(pageLabel("/inventory/stock-adjustments/123"), "Stock Adjustment");
assert.equal(pageLabel("/reports/stock-summary"), "Report");
