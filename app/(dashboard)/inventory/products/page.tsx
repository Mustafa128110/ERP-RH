import { listProductsWithRates } from "@/lib/actions/products";
import { getBrands, getCategories, getCompanies } from "@/lib/queries/lookups";
import { ProductsManager } from "@/components/modules/ProductsManager";
import type { Row } from "@/lib/table";
import { money, qty } from "@/lib/format";

const formatRate = (value: string | null) => (value === null ? null : money(value));

export default async function Page() {
  const [items, companyRows, categoryRows, brandRows] = await Promise.all([
    listProductsWithRates(),
    getCompanies(),
    getCategories(),
    getBrands(),
  ]);

  const rows: Row[] = items.map((item) => ({
    id: item.id,
    name: item.name,
    rate1: formatRate(item.purchaseRate1),
    rate2: formatRate(item.purchaseRate2),
    rate3: formatRate(item.purchaseRate3),
    salesRate: formatRate(item.salesRate),
    // Not columns — the hover panel on the name reads these, and carrying them
    // on the row also means the table's search box finds a product by its SKU,
    // its brand or its category, not only by name.
    sku: item.sku,
    company: item.company,
    category: item.category ?? "—",
    brand: item.brand ?? "—",
    onHand: item.onHand === null ? "None recorded" : qty(item.onHand),
    // Incomplete when the item has no category (e.g. created on the fly from a
    // sale/purchase line).
    _incomplete: !item.categoryId,
    _hasUnitRule: item.hasUnitRule,
    _hasBaseUnit: Boolean(item.baseUnitId),
  }));

  return (
    <ProductsManager rows={rows} companyOptions={companyRows} categoryOptions={categoryRows} brandOptions={brandRows} />
  );
}
