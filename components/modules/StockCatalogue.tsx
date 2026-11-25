import { getProductAssignmentOptions, listProductsWithRates } from "@/lib/actions/products";
import { getBrands, getCategories, getCompanies } from "@/lib/queries/lookups";
import { ProductsManager } from "@/components/modules/ProductsManager";
import type { Row } from "@/lib/table";
import { getSession } from "@/lib/auth/session";
import { listStockLevels } from "@/lib/actions/stock";
import { money, qty } from "@/lib/format";
import { settingsForCompanies } from "@/lib/queries/settings";
import { STOCK_COLUMN_SETTINGS, stockColumnVisibilityFromSettings } from "@/lib/setting-constants";

const formatRate = (value: string | null) => (value === null ? null : money(value));

export async function StockCatalogue() {
  const [items, companyRows, categoryRows, brandRows, assignmentOptions] = await Promise.all([
    listProductsWithRates(),
    getCompanies(),
    getCategories(),
    getBrands(),
    getProductAssignmentOptions(),
  ]);

  const session = await getSession();
  const stockSettingKeys = [
    "highlight_negative_stock",
    "highlight_low_stock",
    "low_stock_qty",
    ...STOCK_COLUMN_SETTINGS.map((col) => col.settingKey),
  ];
  const visual = await settingsForCompanies(companyRows.map((company) => company.id), stockSettingKeys);
  const primaryCompanyId = companyRows[0]?.id ?? "";
  const preference = visual[primaryCompanyId] ?? {};
  const columnVisibility = stockColumnVisibilityFromSettings(preference);
  const canSaveColumnSettings = Boolean(
    primaryCompanyId &&
      session &&
      (session.globalPermissions.has("settings.edit") ||
        session.permissionsByCompany.get(primaryCompanyId)?.has("settings.edit")),
  );
  const canSeeStock =
    session &&
    (session.globalPermissions.has("stock.view") ||
      [...session.permissionsByCompany.values()].some((permissions) => permissions.has("stock.view")));
  const stock = canSeeStock ? await listStockLevels() : [];
  const stockByItem = new Map(stock.map((item) => [item.itemId, item]));
  const unitById = new Map(assignmentOptions.units.map((unit) => [unit.id, unit]));
  const rows: Row[] = items.map((item) => {
    const baseUnit = item.baseUnitId ? unitById.get(item.baseUnitId) : undefined;
    const unitSymbol = baseUnit?.symbol?.trim() || baseUnit?.name || "";
    const stockEntry = stockByItem.get(item.id);
    const stockPlaces =
      stockEntry && stockEntry.breakdown.length > 1
        ? stockEntry.breakdown.map((entry) => ({
            location: entry.location,
            onHand: `${qty(entry.onHand)} ${entry.unit}`.trim(),
            valuation: money(entry.valuation),
          }))
        : [];
    return {
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
      onHand: `${qty(Number(item.onHand ?? 0))} ${unitSymbol}`.trim(),
      valuation: stockEntry ? money(stockEntry.unitTotals.reduce((sum, unit) => sum + unit.valuation, 0)) : null,
      location: stockEntry?.location ?? "—",
      _stockQuantity: Number(item.onHand ?? 0),
      _stockPlaces: JSON.stringify(stockPlaces),
      _stockLocations: stockPlaces.map((place) => place.location).join(" "),
      // Incomplete when the item has no category (e.g. created on the fly from a
      // sale/purchase line).
      // Products render setup gaps in their dedicated Setup column. Do not use
      // DataTable's generic `_incomplete` flag, which would also put a red dot
      // before the first data cell.
      _missingCategory: !item.categoryId,
      _searchItem: `${item.name} ${item.sku}`,
      _hasUnitRule: item.hasUnitRule,
      _hasBaseUnit: Boolean(item.baseUnitId),
      // Flat strings keep DataTable rows serializable while the dedicated setup
      // dot column resolves ids through the rule/unit option lists beside it.
      _ruleIds: item.ruleIds.join(","),
      _baseUnitId: item.baseUnitId,
    };
  });

  return (
    <ProductsManager
      rows={rows}
      companyOptions={companyRows}
      categoryOptions={categoryRows}
      brandOptions={brandRows}
      unitOptions={assignmentOptions.units}
      ruleOptions={assignmentOptions.rules}
      canInlineEdit={Boolean(
        session?.roleNames.some((name) => /^(super\s*admin|administrator|admin)$/i.test(name.trim())) &&
          session.globalPermissions.has("products.edit"),
      )}
      stockHighlight={{
        negative: preference.highlight_negative_stock === "true",
        low: preference.highlight_low_stock === "true",
        threshold: Number(preference.low_stock_qty || 10),
      }}
      columnVisibility={columnVisibility}
      settingsCompanyId={primaryCompanyId}
      canSaveColumnSettings={canSaveColumnSettings}
    />
  );
}
