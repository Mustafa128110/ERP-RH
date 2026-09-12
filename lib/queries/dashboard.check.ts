import assert from "node:assert/strict";
import { db } from "@/lib/db";
import { companies } from "@/lib/db/schema";
import { withReadSnapshot } from "@/lib/db/read-snapshot";
import { loadDashboard } from "./dashboard";
import { loadDashboard as reference } from "./dashboard-reference.check";

async function main() {
  const ids = (await db.select({ id: companies.id }).from(companies)).map(row => row.id);
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Karachi" });
  for (const selected of [[], ...ids.map(id => [id]), ids]) {
    const scopes = { sales: selected, purchases: selected, expenses: selected, accounts: selected, stock: selected };
    await withReadSnapshot(async () => {
      const expected = await reference(today, scopes), actual = await loadDashboard(today, scopes);
      for (const field of ["todaySales", "todayPurchases", "todayExpenses", "cashPosition", "receivables", "payables", "inventoryValue", "outOfStock"] as const) {
        assert.ok(Math.abs(actual[field] - expected[field]) < 0.0001, `${field} changed for scope size ${selected.length}`);
      }
      assert.deepEqual(actual.topProducts.map(row => row.unitsSold), expected.topProducts.map(row => row.unitsSold));
      assert.equal(actual.warehouses.length, expected.warehouses.length);
      for (const warehouse of expected.warehouses) {
        const current = actual.warehouses.find(row => row.name === warehouse.name)!;
        assert.ok(current); assert.equal(current.outOfStock, warehouse.outOfStock);
        assert.ok(Math.abs(current.value - warehouse.value) < 0.0001);
      }
    });
  }
  console.log(`Dashboard equivalence passed for empty, individual and combined company scopes (${ids.length} companies)`);
}
main().finally(() => db.$client.end());
