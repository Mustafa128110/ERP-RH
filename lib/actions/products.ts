"use server";

import { and, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import {
  brands,
  categories,
  companies,
  documentLines,
  inventoryTransactions,
  itemImages,
  itemUnitConversionRules,
  items,
  locations,
  units,
} from "@/lib/db/schema";
import { getLiveSession, getSession } from "@/lib/auth/session";
import { requirePermission } from "@/lib/auth/permissions";
import { companyInPermissionScope, companyInScope, getScopeCompanyIds } from "@/lib/auth/scope";
import { CACHE, getBrands, getCategories, getCompanies, getContactOptions, getLocations, getUnits, invalidateLookups, invalidateReads, READ_DOMAIN } from "@/lib/queries/lookups";
import { csvBool, csvErrorText } from "@/lib/csv";
import { SKU_SCOPE, formatSku, nextSequenceRange, peekSequenceValue } from "@/lib/db/sequences";
import { ensureDocumentType } from "@/lib/actions/document-numbering";
import { createStockPurchase } from "@/lib/actions/purchases";
import { createStockAdjustment } from "@/lib/actions/stock-adjustments";
import { ADJUSTMENT_REASONS, type AdjustmentReason } from "@/lib/adjustment-constants";
import { locationIdOrNull } from "@/lib/location-constants";
import { purchaseRowError, recordsQty, writesDocument } from "@/lib/product-edit-rules";
import { queryProductRates, type ProductRateRow } from "@/lib/queries/products";
import { rebuildItemBaseQuantities } from "@/lib/queries/unit-conversion";
import { guard, describeDbError, DUPLICATE, type ActionResult, type CreateResult } from "@/lib/actions/guard";
import { recordAudit } from "@/lib/actions/audit";
import { cachedPageRead } from "@/lib/read-cache";

export type { ProductRateRow } from "@/lib/queries/products";

// An item's name, unit and rates are read by the sales and purchase lists, the
// stock list, and the product list itself. A price-only edit changes fewer, but
// this file's writes reach all four.
const READS = [READ_DOMAIN.products, READ_DOMAIN.sales, READ_DOMAIN.purchases, READ_DOMAIN.stock] as const;

// Auth, then delegate. The SQL lives in lib/queries/products.ts so a check can
// import and run the real query — this file is "use server", and nothing in it
// is reachable from a test.
export async function listProductsWithRates(): Promise<ProductRateRow[]> {
  const session = await getSession();
  requirePermission(session, "products", "view");
  const companyIds = (await getScopeCompanyIds()).filter(
    (companyId) => session.globalPermissions.has("products.view") || session.permissionsByCompany.get(companyId)?.has("products.view"),
  );
  return cachedPageRead(READ_DOMAIN.products, `${session.userId}:products:${[...companyIds].sort().join(",")}`, () => queryProductRates(companyIds));
}

// The SKU the batch dialog shows as each row's placeholder before you save. A
// peek, not a reservation — opening the dialog and closing it must not burn a
// number, and two people opening it at once should both see RH-00042. The
// numbers that actually stick are allocated per row on save, which is why the
// dialog renders these as placeholders rather than filling them in.
export async function peekNextSku() {
  const session = await getSession();
  requirePermission(session, "products", "create");
  return formatSku(await peekSequenceValue(SKU_SCOPE));
}

export interface ProductBatchRow {
  name: string;
  sku: string;
  companyId: string;
  categoryId: string | null;
  brandId: string | null;
  // A name typed into the category/brand cell that matched nothing: the record
  // is created from it on save, the same rule the edit grid and the sale and
  // purchase line grids follow. Ignored when the matching id is set.
  categoryName?: string | null;
  brandName?: string | null;
  urduName: string | null;
  taxable: boolean;
  isActive: boolean;
}

interface ProductReferenceInput {
  categoryId: string;
  categoryName?: string | null;
  brandId: string;
  brandName?: string | null;
  unitId?: string;
  unitName?: string | null;
}

// Resolve every free-typed catalogue reference in a bounded number of queries.
// Product imports and the edit grid both use this path, so neither can regress
// into one remote database round trip per pasted row.
async function resolveProductReferences(tx: Tx, rows: ProductReferenceInput[]) {
  const categoryNames = [
    ...new Set(
      rows
        .filter((row) => !row.categoryId)
        .map((row) => row.categoryName?.trim())
        .filter((name): name is string => Boolean(name)),
    ),
  ];
  const brandNames = [
    ...new Set(
      rows
        .filter((row) => !row.brandId)
        .map((row) => row.brandName?.trim())
        .filter((name): name is string => Boolean(name)),
    ),
  ];
  const unitNames = [
    ...new Set(
      rows
        .filter((row) => !row.unitId)
        .map((row) => row.unitName?.trim())
        .filter((name): name is string => Boolean(name)),
    ),
  ];

  const [knownCategories, knownBrands, knownUnits] = await Promise.all([
    categoryNames.length
      ? tx.select({ id: categories.id, name: categories.name }).from(categories).where(inArray(categories.name, categoryNames))
      : Promise.resolve([]),
    brandNames.length
      ? tx.select({ id: brands.id, name: brands.name }).from(brands).where(inArray(brands.name, brandNames))
      : Promise.resolve([]),
    unitNames.length
      ? tx.select({ id: units.id, name: units.name }).from(units).where(inArray(units.name, unitNames))
      : Promise.resolve([]),
  ]);
  const categoryByName = new Map(knownCategories.map((row) => [row.name, row.id]));
  const brandByName = new Map(knownBrands.map((row) => [row.name, row.id]));
  const unitByName = new Map(knownUnits.map((row) => [row.name, row.id]));
  const missingCategories = categoryNames.filter((name) => !categoryByName.has(name));
  const missingBrands = brandNames.filter((name) => !brandByName.has(name));
  const missingUnits = unitNames.filter((name) => !unitByName.has(name));

  const [insertedCategories, insertedBrands, insertedUnits] = await Promise.all([
    // Category names are not unique because two branches may legitimately use
    // the same label. We deduplicate this submission, but do not invent a
    // database uniqueness rule that would make the category tree less useful.
    missingCategories.length
      ? tx.insert(categories).values(missingCategories.map((name) => ({ name }))).returning({ id: categories.id, name: categories.name })
      : Promise.resolve([]),
    missingBrands.length
      ? tx
          .insert(brands)
          .values(missingBrands.map((name) => ({ name })))
          .onConflictDoUpdate({ target: brands.name, set: { name: sql`excluded.name` } })
          .returning({ id: brands.id, name: brands.name })
      : Promise.resolve([]),
    missingUnits.length
      ? tx.insert(units).values(missingUnits.map((name) => ({ name }))).returning({ id: units.id, name: units.name })
      : Promise.resolve([]),
  ]);
  for (const row of insertedCategories) categoryByName.set(row.name, row.id);
  for (const row of insertedBrands) brandByName.set(row.name, row.id);
  for (const row of insertedUnits) unitByName.set(row.name, row.id);

  return rows.map((row) => ({
    categoryId: row.categoryId || categoryByName.get(row.categoryName?.trim() ?? "") || null,
    brandId: row.brandId || brandByName.get(row.brandName?.trim() ?? "") || null,
    unitId: row.unitId || unitByName.get(row.unitName?.trim() ?? "") || null,
  }));
}

// Returns what it created so a quick-add from a sale or purchase line can drop
// the new product straight into the line the user was editing.
export async function createProductsBatch(
  rows: ProductBatchRow[],
): Promise<CreateResult<{ id: string; name: string; sku: string; companyId: string }>> {
  return guard(
    "Couldn't save the products.",
    async () => {
      const session = await getLiveSession();
      requirePermission(session, "products", "create");

      // SKU is no longer required to submit a row — a blank one gets the next RH-
      // number, so a batch can be pasted in with just names.
      const valid = rows.filter((r) => r.name.trim() && r.companyId);
      if (valid.length === 0) return { error: "Add at least one product with a name and company." };
      // Every company the batch files under must be one the user belongs to and
      // can create products in — a row carrying a forged or stale companyId is
      // refused rather than filed into another set of books.
      for (const companyId of new Set(valid.map((r) => r.companyId))) {
        requirePermission(session, "products", "create", { companyId });
      }

      const created = await db.transaction(async (tx) => {
        const blankSkuCount = valid.filter((row) => !row.sku.trim()).length;
        const [references, skuValues] = await Promise.all([
          resolveProductReferences(tx, valid.map((row) => ({ ...row, categoryId: row.categoryId ?? "", brandId: row.brandId ?? "" }))),
          nextSequenceRange(SKU_SCOPE, blankSkuCount, tx),
        ]);
        let skuIndex = 0;
        const withSkus = valid.map((row, index) => ({
          companyId: row.companyId,
          name: row.name,
          urduName: row.urduName,
          categoryId: references[index]!.categoryId,
          brandId: references[index]!.brandId,
          taxable: row.taxable,
          isActive: row.isActive,
          sku: row.sku.trim() || formatSku(skuValues[skuIndex++]),
        }));
        return tx.insert(items).values(withSkus).returning({ id: items.id, name: items.name, sku: items.sku, companyId: items.companyId });
      });

      await invalidateLookups(CACHE.items, CACHE.categories, CACHE.brands);
      await invalidateReads(...READS);
      revalidatePath("/inventory/products");
      await recordAudit({
        action: "create",
        entity: "product",
        summary: created.map((c) => c.name).slice(0, 5).join(", ") + (created.length > 5 ? ` +${created.length - 5} more` : ""),
        companyId: valid[0]?.companyId,
      });
      return { created };
    },
    { [DUPLICATE]: "Can't create — one or more SKUs are already in use." },
  );
}
// --- Edit products in bulk -------------------------------------------------

// One selected product, as the edit grid shows it. Category and brand carry the
// current name alongside the id because the grid's typeahead needs something to
// display, and a name typed over it is what creates a new one.
export interface ProductEditRow {
  id: string;
  companyId: string;
  company: string;
  sku: string;
  name: string;
  urduName: string | null;
  categoryId: string | null;
  categoryName: string | null;
  brandId: string | null;
  brandName: string | null;
  taxable: boolean;
  isActive: boolean;
  // The one unit in which this product's stock is calculated. It is a product
  // setting, separate from the unit used on the last purchase.
  baseUnitId: string | null;
  // Everything the last purchase of this item already answered, so the edit grid
  // opens with those cells filled in rather than blank: who it came from, the
  // unit it was bought in, and what it cost. Editing them writes to the same
  // places these were read from — there is no second copy of a supplier.
  // All null for an item that has never been purchased.
  lastSupplierId: string | null;
  lastUnitId: string | null;
  // ISO date of that last purchase, so the dialog opens on it rather than today.
  lastPurchaseDate: string | null;
  purchaseRate: string | null;
  // Not editable anywhere — it's whatever the item last sold for, which is set
  // by raising a sale, not by this dialog.
  salesRate: string | null;
  // One entry per location + unit the item has ever moved in — the same grain a
  // stock adjustment works at, so "set stock to N" has something exact to
  // subtract from. locationId/unitId are null for movements booked without one.
  stock: { locationId: string | null; location: string; unitId: string | null; unit: string; onHand: number }[];
}

export interface ProductEditData {
  rows: ProductEditRow[];
  // Contacts are company-scoped, so the grid filters these by each row's own
  // company; units and locations are global.
  supplierOptions: { id: string; name: string; companyId: string | null }[];
  unitOptions: { id: string; name: string }[];
  locationOptions: { id: string; name: string }[];
}

// Loaded when the Edit button is pressed rather than shipped with every list
// row: the derived half (suppliers, stock) is three joins per item, and only the
// handful that were ticked are ever opened.
export async function getProductsForEdit(itemIds: string[]): Promise<ProductEditData> {
  const session = await getSession();
  requirePermission(session, "products", "view");

  const empty: ProductEditData = { rows: [], supplierOptions: [], unitOptions: [], locationOptions: [] };
  if (itemIds.length === 0) return empty;

  const rows = await db
    .select({
      id: items.id,
      companyId: items.companyId,
      company: sql<string>`coalesce(${companies.shortName}, ${companies.name})`,
      sku: items.sku,
      name: items.name,
      urduName: items.urduName,
      categoryId: items.categoryId,
      categoryName: categories.name,
      brandId: items.brandId,
      brandName: brands.name,
      baseUnitId: items.baseUnitId,
      taxable: items.taxable,
      isActive: items.isActive,
    })
    .from(items)
    .innerJoin(companies, eq(companies.id, items.companyId))
    .leftJoin(categories, eq(categories.id, items.categoryId))
    .leftJoin(brands, eq(brands.id, items.brandId))
    .where(and(inArray(items.id, itemIds), await companyInPermissionScope(items.companyId, session, "products")))
    .orderBy(items.name);
  if (rows.length === 0) return empty;

  const ids = rows.map((r) => r.id);

  // Same derivation as the stock list (lib/actions/stock.ts) — SUM(movement *
  // base_quantity) — grouped by location and unit rather than rolled up, because
  // that's the grain an adjustment is written at.
  const stockRowsPromise = db
    .select({
      itemId: documentLines.itemId,
      locationId: documentLines.locationId,
      location: sql<string>`coalesce(${locations.name}, 'Unassigned')`,
      unitId: documentLines.unitId,
      unit: sql<string>`coalesce(${units.symbol}, ${units.name}, '—')`,
      onHand: sql<string>`sum(${inventoryTransactions.movement} * ${inventoryTransactions.baseQuantity})`,
    })
    .from(inventoryTransactions)
    .innerJoin(documentLines, eq(documentLines.id, inventoryTransactions.documentLineId))
    .leftJoin(units, eq(units.id, documentLines.unitId))
    .leftJoin(locations, eq(locations.id, documentLines.locationId))
    .where(inArray(documentLines.itemId, ids))
    .groupBy(documentLines.itemId, documentLines.locationId, locations.name, documentLines.unitId, units.symbol, units.name);

  // The rate columns, for exactly the items being edited. Same derivation the
  // products list uses (lib/actions/products.ts listProductsWithRates): the last
  // three purchase prices from the rate_list view, falling back to the cost
  // typed on a sale line for an item never actually purchased, plus the price it
  // last sold at. The id list binds one parameter per id — a raw `= ANY(array)`
  // mis-binds under drizzle's execute().
  const idList = sql.join(
    ids.map((id) => sql`${id}`),
    sql`, `,
  );
  const rateRowsPromise = db.execute<{
    id: string;
    purchase_rate_1: string | null;
    sales_rate: string | null;
  }>(sql`
    SELECT rl.id,
           coalesce(rl.purchase_rate_1, c.unit_cost) AS purchase_rate_1,
           s.unit_price AS sales_rate
    FROM rate_list rl
    LEFT JOIN LATERAL (
      SELECT dl.unit_price
      FROM document_lines dl
      JOIN documents d ON d.id = dl.document_id
      JOIN document_types dt ON dt.id = d.document_type_id
      WHERE dl.item_id = rl.id AND dt.code = 'SALES_INVOICE'
      ORDER BY d.document_date DESC, dl.line_no DESC
      LIMIT 1
    ) s ON true
    LEFT JOIN LATERAL (
      SELECT dl.unit_cost
      FROM document_lines dl
      JOIN documents d ON d.id = dl.document_id
      JOIN document_types dt ON dt.id = d.document_type_id
      WHERE dl.item_id = rl.id AND dt.code = 'SALES_INVOICE' AND dl.unit_cost IS NOT NULL
      ORDER BY d.document_date DESC, dl.line_no DESC
      LIMIT 1
    ) c ON true
    WHERE rl.id IN (${idList})`);
  // Who it was last bought from and in what unit. DISTINCT ON keeps the first
  // row per item under the ORDER BY, which is the newest line — the same "last
  // purchase wins" rule the rate columns follow. Stock receipts count alongside
  // purchase invoices: both are this item arriving.
  const lastPurchaseRowsPromise = db.execute<{
    item_id: string;
    contact_id: string | null;
    unit_id: string | null;
    document_date: string | null;
  }>(sql`
    SELECT DISTINCT ON (dl.item_id) dl.item_id, d.contact_id, dl.unit_id, d.document_date
    FROM document_lines dl
    JOIN documents d ON d.id = dl.document_id
    JOIN document_types dt ON dt.id = d.document_type_id
    WHERE dl.item_id IN (${idList})
      AND dt.code IN ('PURCHASE_INVOICE', 'STOCK_OPENING')
    ORDER BY dl.item_id, d.document_date DESC, dl.line_no DESC`);
  const [stockRows, rateRows, lastPurchaseRows, supplierOpts, unitOpts, locationOpts] = await Promise.all([
    stockRowsPromise,
    rateRowsPromise,
    lastPurchaseRowsPromise,
    getContactOptions(),
    getUnits(),
    getLocations(),
  ]);
  const ratesById = new Map(rateRows.map((row) => [row.id, row]));
  const lastPurchaseById = new Map(lastPurchaseRows.map((row) => [row.item_id, row]));
  const stockByItem = new Map<string, ProductEditRow["stock"]>();
  for (const row of stockRows) {
    if (!row.itemId || Number(row.onHand) === 0) continue;
    const stock = stockByItem.get(row.itemId) ?? [];
    stock.push({ ...row, onHand: Number(row.onHand) });
    stockByItem.set(row.itemId, stock);
  }

  return {
    rows: rows.map((r) => ({
      ...r,
      taxable: r.taxable ?? false,
      isActive: r.isActive ?? true,
      baseUnitId: r.baseUnitId,
      lastSupplierId: lastPurchaseById.get(r.id)?.contact_id ?? null,
      lastUnitId: lastPurchaseById.get(r.id)?.unit_id ?? null,
      // A `date` column comes back as YYYY-MM-DD, which is what the form wants.
      lastPurchaseDate: lastPurchaseById.get(r.id)?.document_date ?? null,
      purchaseRate: ratesById.get(r.id)?.purchase_rate_1 ?? null,
      salesRate: ratesById.get(r.id)?.sales_rate ?? null,
      stock: stockByItem.get(r.id) ?? [],
    })),
    supplierOptions: supplierOpts.map((c) => ({ id: c.id, name: c.displayName, companyId: c.companyId })),
    unitOptions: unitOpts.map((u) => ({ id: u.id, name: u.symbol ? `${u.name} (${u.symbol})` : u.name })),
    locationOptions: locationOpts.map((l) => ({ id: l.id, name: l.name })),
  };
}

// What one row of the edit grid submits. Every reference is an id-or-name pair:
// the id when an existing record was picked from the typeahead, otherwise the
// typed name for the resolvers to find or create.
export interface ProductEditInput {
  // Blank on a row added in the dialog — that row creates a product instead of
  // updating one, so a batch can fix five items and add two in the same pass.
  id: string;
  // Only read when `id` is blank; an existing product's company is never moved.
  companyId: string;
  name: string;
  sku: string;
  urduName: string;
  categoryId: string;
  categoryName: string;
  brandId: string;
  brandName: string;
  taxable: boolean;
  isActive: boolean;
  unitId: string;
  unitName: string;
  supplierId: string;
  supplierName: string;
  purchaseQty: string;
  purchaseRate: string;
  targetQty: string;
}

// Settings the whole batch shares. Location, date and reason are the same for
// every row in practice — a stock count is one count, a delivery is one
// delivery — so they sit above the grid instead of repeating per row.
export interface ProductBatchEditShared {
  // "none" edits the catalogue details only and writes no document.
  mode: "none" | "purchase" | "adjust";
  locationId: string;
  documentDate: string;
  reason: string;
}

// company_id is deliberately not editable: catalogs are per company and stock
// hangs off the row, so moving a product between them would move stock between
// two sets of books with no document saying so — the same reason mergeProducts
// refuses a cross-company merge.
//
// Supplier, quantity and purchase rate are not columns on items and never will
// be — they're properties of a purchase, and the tables that hold them are
// documents / document_lines / inventory_transactions. Filling them in here
// therefore books a document, exactly as the Stock Purchase and Stock
// Adjustment screens do, rather than stamping a number onto the product that
// the next invoice would immediately contradict. That's what makes the rate
// show up in rate_list, the supplier in the item's supplier list, and the
// quantity in on-hand stock.
//
// Two ways to write stock, because they answer different questions:
//   purchase — "we bought 40 more of these, from them, at this price". Adds to
//              stock, sets the rate, records the supplier, books the payable.
//   adjust   — "there are 12 on the shelf, whatever the system thinks". No
//              supplier and no price; the difference against what's currently
//              recorded is posted as a stock adjustment with a reason.
//
// Rows are grouped into documents rather than each getting its own: an invoice
// has one supplier, so items bought from the same one on the same day are lines
// on a single invoice — which is what the delivery note looked like.
export async function updateProductsBatch(
  shared: ProductBatchEditShared,
  rows: ProductEditInput[],
): Promise<ActionResult> {
  return guard("Couldn't save the products.", async () => {
    const session = await getLiveSession();
    requirePermission(session, "products", "edit");
    // Rows added in the dialog create products, which is a different permission
    // from editing the ones already there.
    if (rows.some((r) => !r.id)) requirePermission(session, "products", "create");

    if (rows.length === 0) return { error: "Nothing selected to edit." };

    const submittedIds = new Set<string>();
    for (const [i, row] of rows.entries()) {
      if (row.id && submittedIds.has(row.id)) return { error: `Row ${i + 1}: the same product was submitted more than once.` };
      if (row.id) submittedIds.add(row.id);
    }

    // Every row is checked before any row is written. A batch that fails on row
    // seven having already saved rows one to six is the worst outcome here — the
    // user can't tell what landed without re-reading the list.
    for (const [i, row] of rows.entries()) {
      const where = `Row ${i + 1} (${row.name.trim() || "unnamed"})`;
      if (!row.name.trim()) return { error: `${where}: name is required.` };
      // A new row may leave the SKU blank and take the next RH- number, the same
      // as the add dialog. An existing product can't have its SKU emptied.
      if (row.id && !row.sku.trim()) return { error: `${where}: SKU is required.` };
      if (!row.id && !row.companyId) return { error: `${where}: pick a company for the new product.` };

      if (shared.mode === "purchase") {
        const rowError = purchaseRowError(row, where);
        if (rowError) return { error: rowError };
      }

      if (shared.mode === "adjust" && row.targetQty.trim() !== "") {
        const target = Number(row.targetQty);
        if (!Number.isFinite(target) || target < 0) return { error: `${where}: stock level must be zero or more.` };
      }
    }

    // A row writes a document if it records a rate, a quantity, or both.
    const writesDocuments =
      (shared.mode === "purchase" && rows.some(writesDocument)) ||
      (shared.mode === "adjust" && rows.some((r) => r.targetQty.trim() !== ""));
    if (writesDocuments && !shared.documentDate) return { error: "Enter the date for the documents this will create." };
    // Both documents put stock somewhere and neither guesses: an adjustment has no
    // "current" to measure a target against without a location, and goods that
    // arrive nowhere can only ever be shown as Unassigned. A rate on its own moves
    // no stock, so it needs no location.
    const movesStock =
      (shared.mode === "purchase" && rows.some(recordsQty)) || (shared.mode === "adjust" && rows.some((r) => r.targetQty.trim() !== ""));
    if (movesStock && !shared.locationId) {
      return { error: shared.mode === "adjust" ? "Pick the location whose stock levels you're setting." : "Pick the location the goods arrived at." };
    }      if (shared.mode === "adjust" && writesDocuments) {
        if (!ADJUSTMENT_REASONS.includes(shared.reason as AdjustmentReason)) return { error: "Pick a reason for the stock adjustments." };
      }

      // Rows added in the dialog create products — products.create in each new
      // product's company. Existing rows are checked against the user's live
      // company scope together inside the catalogue transaction.
      for (const companyId of new Set(rows.filter((r) => !r.id).map((r) => r.companyId).filter(Boolean))) {
        requirePermission(session, "products", "create", { companyId });
      }

    // The catalogue half lands atomically and uses a bounded statement count:
    // references are resolved in batches, existing products update through one
    // UPDATE ... FROM (VALUES ...), and new products use one multi-row INSERT.
    const scope = await companyInPermissionScope(items.companyId, session, "products", "edit");
    let saved: SavedProductRow[] = [];
    const rowFailure = await db
      .transaction(async (tx) => {
        const existingInputs = rows.map((row, index) => ({ row, index })).filter(({ row }) => Boolean(row.id));
        const existing = existingInputs.length
          ? await tx
              .select({ id: items.id, companyId: items.companyId })
              .from(items)
              .where(and(inArray(items.id, existingInputs.map(({ row }) => row.id)), scope))
          : [];
        const existingById = new Map(existing.map((row) => [row.id, row.companyId]));
        const missing = existingInputs.find(({ row }) => !existingById.has(row.id));
        if (missing) {
          throw new RowError(`Row ${missing.index + 1} (${missing.row.name.trim()}): this product no longer exists, or isn't in your company scope.`);
        }

        const blankNewSkuCount = rows.filter((row) => !row.id && !row.sku.trim()).length;
        const [references, skuValues] = await Promise.all([
          resolveProductReferences(tx, rows),
          nextSequenceRange(SKU_SCOPE, blankNewSkuCount, tx),
        ]);
        let skuIndex = 0;
        const prepared = rows.map((row, index) => ({
          row,
          index,
          categoryId: references[index]!.categoryId,
          brandId: references[index]!.brandId,
          unitId: references[index]!.unitId,
          sku: row.sku.trim() || formatSku(skuValues[skuIndex++]),
        }));
        const updates = prepared.filter(({ row }) => Boolean(row.id));
        const creates = prepared.filter(({ row }) => !row.id);

        const updated = updates.length
          ? await tx.execute<{ id: string; company_id: string }>(sql`
              UPDATE items
              SET name = source.name,
                  urdu_name = source.urdu_name,
                  category_id = source.category_id,
                  brand_id = source.brand_id,
                  taxable = source.taxable,
                  is_active = source.is_active,
                  base_unit_id = source.base_unit_id,
                  sku = source.sku
              FROM (VALUES ${sql.join(
                updates.map(({ row, categoryId, brandId, unitId, sku }) => sql`(
                  ${row.id}::uuid,
                  ${row.name.trim()}::text,
                  ${row.urduName.trim() || null}::text,
                  ${categoryId}::uuid,
                  ${brandId}::uuid,
                  ${row.taxable}::boolean,
                  ${row.isActive}::boolean,
                  ${unitId}::uuid,
                  ${sku}::text
                )`),
                sql`, `,
              )}) AS source(id, name, urdu_name, category_id, brand_id, taxable, is_active, base_unit_id, sku)
              WHERE items.id = source.id
              RETURNING items.id, items.company_id`)
          : [];
        if (updated.length !== updates.length) throw new RowError("One or more products changed while this batch was being saved. Reload and try again.");

        const created = creates.length
          ? await tx
              .insert(items)
              .values(
                creates.map(({ row, categoryId, brandId, unitId, sku }) => ({
                  companyId: row.companyId,
                  name: row.name.trim(),
                  urduName: row.urduName.trim() || null,
                  categoryId,
                  brandId,
                  taxable: row.taxable,
                  isActive: row.isActive,
                  baseUnitId: unitId,
                  sku,
                })),
              )
              .returning({ id: items.id, companyId: items.companyId, sku: items.sku })
          : [];
        const updatedById = new Map(updated.map((row) => [row.id, row.company_id]));
        const createdByKey = new Map(created.map((row) => [`${row.companyId}::${row.sku}`, row]));
        saved = prepared.map(({ row, index, unitId, sku }) => {
          const createdRow = createdByKey.get(`${row.companyId}::${sku}`);
          const itemId = row.id || createdRow?.id;
          const companyId = row.id ? updatedById.get(row.id) : createdRow?.companyId;
          if (!itemId || !companyId) throw new RowError(`Row ${index + 1} (${row.name.trim()}): the product could not be saved.`);
          return { row, index, itemId, companyId, unitId };
        });
        await rebuildItemBaseQuantities(tx, saved.map((row) => row.itemId));
        return null;
      })
      .catch((e) => {
        if (e instanceof RowError) return e.message;
        throw e;
      });
    if (rowFailure) return { error: rowFailure };

    // Documents are written after the catalogue commits, not inside it: they go
    // through createStockPurchase / createStockAdjustment, which open transactions
    // of their own. That seam is why the messages below say "saved, but…" — the
    // products are already stored at that point, and saying so is the difference
    // between "try the stock part again" and "type it all in again".
    const documentError =
      shared.mode === "purchase" ? await recordPurchases(shared, saved) : shared.mode === "adjust" ? await recordAdjustments(shared, saved) : null;
    if (documentError) return { error: documentError };

    await invalidateLookups(CACHE.items, CACHE.categories, CACHE.brands, CACHE.units);
    await invalidateReads(...READS);
    revalidatePath("/inventory/products");
    revalidatePath("/inventory/stock");
    await recordAudit({
      action: "update",
      entity: "product",
      summary: `${rows.length} product(s) edited`,
      companyId: saved[0]?.companyId,
      detail: shared.mode === "none" ? null : `mode: ${shared.mode}`,
    });
    return { success: true };
  });
}

// Carries a row-specific message out of the batch transaction. The outer guard
// still guarantees that no mutation exception reaches the form boundary.
class RowError extends Error {}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

interface SavedProductRow {
  row: ProductEditInput;
  // Position in the submitted batch, kept so an error can name the row the user
  // is looking at rather than the position within some group.
  index: number;
  itemId: string;
  companyId: string;
  unitId: string | null;
}

// A purchase invoice has one supplier and belongs to one company, so that pair is
// what decides how many invoices a batch produces: five items bought from one
// supplier are one invoice with five lines, which is what the delivery note
// actually looked like. Two suppliers in the grid means two invoices.
//
// A typed supplier name groups on the exact trimmed text rather than a
// case-folded one, because that is the comparison resolveContactId makes — two
// spellings resolve to two contacts, so they have to produce two invoices or one
// of them would be filed against the wrong one.
function invoiceKey(saved: SavedProductRow) {
  const supplier = saved.row.supplierId || `name:${saved.row.supplierName.trim()}`;
  return `${saved.companyId}::${supplier}`;
}

async function recordPurchases(shared: ProductBatchEditShared, saved: SavedProductRow[]): Promise<string | null> {
  const groups = new Map<string, SavedProductRow[]>();
  for (const s of saved) {
    // A rate with no quantity still books a line — that's what puts the price in
    // rate_list. It just carries quantity 0, so nothing lands in stock.
    const qty = Number(s.row.purchaseQty.trim() || "0");
    if (!(qty > 0) && !(Number(s.row.purchaseRate) > 0)) continue;
    const key = invoiceKey(s);
    groups.set(key, [...(groups.get(key) ?? []), s]);
  }

  const errors = await Promise.all([...groups.values()].map(async (group) => {
    const { companyId, row: first } = group[0];
    // Delegated to createStockPurchase rather than reimplemented: it is what
    // allocates the document number, writes the lines and posts the +1 inventory
    // movements. Whether any of it reaches the ledger is decided by the document
    // type's own affects* flags, which is why the type below is the whole of the
    // difference between this and a real purchase.
    //
    // A stock receipt, not a purchase invoice. Editing a product is catalogue
    // work: it records what arrived and what it cost, so the quantity lands in
    // stock and the rate lands in rate_list — but it books nothing to the
    // ledger, owes nobody, and is neither paid nor unpaid. A real delivery with
    // an invoice behind it is entered on the Stock Purchase screen, which is
    // still the only thing that creates a payable.
    const documentType = await ensureDocumentType({
      companyId,
      code: "STOCK_OPENING",
      name: "Stock Receipt",
      series: "OS",
      affectsInventory: true,
      affectsAccounting: false,
      affectsPayable: false,
      active: true,
    });

    const purchaseForm = new FormData();
    purchaseForm.set("companyId", companyId);
    purchaseForm.set("documentDate", shared.documentDate);
    purchaseForm.set("documentTypeMode", "existing");
    purchaseForm.set("documentTypeId", String(documentType.id));
    // Every row in the group named the same supplier — that's what grouped them —
    // so the first row's answer speaks for all of them. A typed name is created by
    // createStockPurchase's own resolveContactId, under this company.
    purchaseForm.set("contactId", first.supplierId);
    purchaseForm.set("contactName", first.supplierId ? "" : first.supplierName.trim());
    // Ignored for this type — a receipt is neither paid nor unpaid — but sent so
    // the form shape is the one createStockPurchase expects.
    purchaseForm.set("isPaid", "no");
    // Location is a header field — one delivery, one place — which is also how
    // the batch grid asks for it.
    purchaseForm.set("locationId", locationIdOrNull(shared.locationId) ?? "");
    purchaseForm.set(
      "linesJson",
      JSON.stringify(
        group.map((s) => ({
          itemId: s.itemId,
          itemName: "",
          unitId: s.unitId ?? "",
          unitName: "",
          quantity: String(Number(s.row.purchaseQty)),
          // unit_price is the purchase rate — rate_list reads it, which is how
          // the rate columns on the products list get their values.
          unitPrice: s.row.purchaseRate,
          unitCost: "",
        })),
      ),
    );

    const result = await createStockPurchase(undefined, purchaseForm);
    if (result.error) return `${rowLabel(group)} saved, but the stock wasn't recorded: ${result.error}`;
    return null;
  }));

  return errors.find((error): error is string => Boolean(error)) ?? null;
}

// The mirror of the above: location, date and reason are shared by the whole
// batch, so a stock count over eight products is one adjustment document with
// eight lines. Only the company splits them, since a document belongs to one.
async function recordAdjustments(shared: ProductBatchEditShared, saved: SavedProductRow[]): Promise<string | null> {
  // Unassigned is a place stock can sit, so it has to match NULL rather than
  // fall through to "every location".
  const locationId = locationIdOrNull(shared.locationId);

  const targets = saved.filter((row) => row.row.targetQty.trim() !== "");
  if (targets.length === 0) return null;

  // One grouped read for the whole grid. The previous loop issued one aggregate
  // statement per product, so twenty corrected rows paid twenty remote round
  // trips before the adjustment document could even be created.
  const currentRows = await db
    .select({
      itemId: documentLines.itemId,
      unitId: documentLines.unitId,
      onHand: sql<string>`coalesce(sum(${inventoryTransactions.movement} * ${inventoryTransactions.baseQuantity}), 0)`,
    })
    .from(inventoryTransactions)
    .innerJoin(documentLines, eq(documentLines.id, inventoryTransactions.documentLineId))
    .where(
      and(
        inArray(documentLines.itemId, [...new Set(targets.map((row) => row.itemId))]),
        locationId ? eq(documentLines.locationId, locationId) : isNull(documentLines.locationId),
      ),
    )
    .groupBy(documentLines.itemId, documentLines.unitId);

  const stockKey = (itemId: string, unitId: string | null) => `${itemId}:${unitId ?? "unassigned"}`;
  const onHandByItemUnit = new Map(
    currentRows.filter((row) => row.itemId).map((row) => [stockKey(row.itemId!, row.unitId), Number(row.onHand)]),
  );

  const groups = new Map<string, { rows: SavedProductRow[]; lines: unknown[] }>();
  for (const s of targets) {
    const delta = Number(s.row.targetQty) - (onHandByItemUnit.get(stockKey(s.itemId, s.unitId)) ?? 0);
    // Already at the target — a line of zero would be a paper trail recording
    // that nothing happened.
    if (delta === 0) continue;

    const group = groups.get(s.companyId) ?? { rows: [], lines: [] };
    group.rows.push(s);
    // Signed: createStockAdjustment reads the sign as the movement direction and
    // stores the quantity absolute.
    group.lines.push({ itemId: s.itemId, itemName: "", unitId: s.unitId ?? "", unitName: "", quantity: String(delta) });
    groups.set(s.companyId, group);
  }

  for (const [companyId, group] of groups) {
    const adjustForm = new FormData();
    adjustForm.set("companyId", companyId);
    adjustForm.set("documentDate", shared.documentDate);
    adjustForm.set("locationId", shared.locationId);
    adjustForm.set("reason", shared.reason);
    adjustForm.set("linesJson", JSON.stringify(group.lines));

    const result = await createStockAdjustment(undefined, adjustForm);
    if (result.error) return `${rowLabel(group.rows)} saved, but the stock level wasn't set: ${result.error}`;
  }

  return null;
}

// Names the grid rows a failed document came from, so "row 2 and row 5" points at
// what the user is looking at rather than at a position inside some group.
function rowLabel(group: SavedProductRow[]) {
  const numbers = group.map((s) => s.index + 1);
  return numbers.length === 1 ? `Row ${numbers[0]} details` : `Rows ${numbers.join(", ")} details`;
}

// --- Merge ---------------------------------------------------------------

// The same physical product ends up in the catalog twice easily: typed into a
// sale line under a slightly different name, created on the fly by a purchase,
// or (until migration 0042) minted by an inter-company sale. Merging folds the
// duplicates into one row and moves their history with them, so stock and rates
// stop being split across two half-used entries.

export interface MergeCandidate {
  id: string;
  name: string;
  sku: string;
  companyId: string;
  company: string;
  // What a merge would carry across — shown so the size of the change is visible
  // before it happens.
  lines: number;
  movements: number;
}

export async function listMergeCandidates(): Promise<MergeCandidate[]> {
  const session = await getSession();
  requirePermission(session, "products", "view");

  const rows = await db
    .select({
      id: items.id,
      name: items.name,
      sku: items.sku,
      companyId: items.companyId,
      company: sql<string>`coalesce(${companies.shortName}, ${companies.name})`,
      lines: sql<number>`(select count(*) from ${documentLines} dl where dl.item_id = ${items.id})`,
      movements: sql<number>`(
        select count(*) from inventory_transactions it
        join ${documentLines} dl on dl.id = it.document_line_id
        where dl.item_id = ${items.id}
      )`,
    })
    .from(items)
    .innerJoin(companies, eq(companies.id, items.companyId))
    .where(await companyInPermissionScope(items.companyId, session, "products"))
    .orderBy(items.name);

  return rows.map((r) => ({ ...r, lines: Number(r.lines), movements: Number(r.movements) }));
}

export async function mergeProducts(
  _prevState: ActionResult | undefined,
  formData: FormData,
): Promise<{ error?: string; success?: boolean }> {
  return guard("Couldn't merge the products.", async () => {
  const session = await getLiveSession();
  // Rewrites one product and destroys the others, so it needs both.
  requirePermission(session, "products", "edit");
  requirePermission(session, "products", "delete");

  const survivorId = String(formData.get("survivorId") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const sku = String(formData.get("sku") ?? "").trim();
  let itemIds: string[];
  try {
    itemIds = JSON.parse(String(formData.get("itemIds") ?? "[]"));
  } catch (e) {
    return { error: describeDbError(e, "Nothing to merge.") };
  }

  if (itemIds.length < 2) return { error: "Pick at least two products to merge." };
  if (!survivorId || !itemIds.includes(survivorId)) return { error: "Pick which product survives the merge." };
  if (!name || !sku) return { error: "The surviving product needs a name and a SKU." };

  // Read scoped: a guessed id from an unauthorized company is "not found", and
  // the merge permission is checked against the merged company below.
  const rows = await db
    .select({ id: items.id, companyId: items.companyId })
    .from(items)
    .where(and(inArray(items.id, itemIds), await companyInScope(items.companyId)));
  if (rows.length !== itemIds.length) return { error: "One of these products no longer exists, or isn't in your company scope." };
  // Catalogs are per company and so is stock. Folding an M52 row into a Royal
  // one would move stock between two sets of books without a document saying so.
  if (new Set(rows.map((r) => r.companyId)).size > 1) return { error: "These products belong to different companies — merge within one company." };
  // The scoped read already proved membership; re-check both permissions for
  // the company the merged product will live in.
  requirePermission(session, "products", "edit", { companyId: rows[0].companyId });
  requirePermission(session, "products", "delete", { companyId: rows[0].companyId });

  const loserIds = itemIds.filter((id) => id !== survivorId);

  try {
    await db.transaction(async (tx) => {
      // inventory_transactions hangs off document_lines, not items, so moving the
      // lines moves the stock movements with them — on-hand and valuation come
      // out the same, just under one product.
      await tx.update(documentLines).set({ itemId: survivorId }).where(inArray(documentLines.itemId, loserIds));

      // Rules are reusable. Keep every assignment represented by a loser on the
      // survivor (once), then remove only the loser assignments — definitions
      // remain available to every other product that uses them.
      await tx.execute(sql`
        INSERT INTO item_unit_conversion_rules (item_id, rule_id)
        SELECT ${survivorId}::uuid, rule_id
        FROM item_unit_conversion_rules
        WHERE item_id IN (${sql.join(loserIds.map((id) => sql`${id}::uuid`), sql`, `)})
        ON CONFLICT (item_id, rule_id) DO NOTHING
      `);
      await tx.delete(itemUnitConversionRules).where(inArray(itemUnitConversionRules.itemId, loserIds));

      // item_images.item_id is ON DELETE CASCADE, so these would be thrown away
      // with the row rather than kept. isPrimary is cleared on the way over — the
      // survivor's own primary image stays the primary one.
      await tx.update(itemImages).set({ itemId: survivorId, isPrimary: false }).where(inArray(itemImages.itemId, loserIds));

      // Losers go first, then the survivor is renamed. The other order fails when
      // the SKU being kept is one of theirs — items is UNIQUE(company_id, sku),
      // and the row still holding it would not have been deleted yet.
      await tx.delete(items).where(and(inArray(items.id, loserIds), ne(items.id, survivorId)));
      await tx.update(items).set({ name, sku }).where(eq(items.id, survivorId));
    });
  } catch (e) {
    return { error: describeDbError(e, "Can't merge — that SKU is already used by another product in this company, or one of these rows is still referenced elsewhere.") };
  }

  await invalidateLookups(CACHE.items);
  await invalidateReads(...READS);
  revalidatePath("/inventory/products");
  revalidatePath("/inventory/stock");
  revalidatePath("/dashboard");
  await recordAudit({
    action: "merge",
    entity: "product",
    entityId: survivorId,
    summary: `${name} (${sku})`,
    companyId: rows[0]?.companyId,
    detail: `${loserIds.length} duplicate(s) folded in`,
  });
  return { success: true };
  });
}

// --- CSV import / export ---------------------------------------------------

// The columns and their headings live in lib/csv-columns.ts (PRODUCT_CSV_COLUMNS)
// — the template download, the export and this import all read that one list, so
// a file saved from the template imports without editing.
//
// Everything here is a name, not an id: the same names the pickers show. An
// unmatched category or brand is created on save, the same as typing one into
// the batch dialog. A company is not — you can only file under a company you
// already have access to, and inventing one from a typo is not a thing an
// import should do.

export async function exportProductsCsv(): Promise<Record<string, string>[]> {
  const session = await getSession();
  requirePermission(session, "products", "view");

  const [rows, rates] = await Promise.all([
    db
      .select({
        id: items.id,
        company: sql<string>`coalesce(${companies.shortName}, ${companies.name})`,
        name: items.name,
        sku: items.sku,
        urduName: items.urduName,
        category: categories.name,
        brand: brands.name,
        taxable: items.taxable,
        isActive: items.isActive,
      })
      .from(items)
      .innerJoin(companies, eq(companies.id, items.companyId))
      .leftJoin(categories, eq(categories.id, items.categoryId))
      .leftJoin(brands, eq(brands.id, items.brandId))
      .where(await companyInPermissionScope(items.companyId, session, "products"))
      .orderBy(items.name),
    // The four rate columns are derived, so they come from the same place the
    // products list reads them from rather than being recomputed here.
    listProductsWithRates(),
  ]);

  const rateById = new Map(rates.map((r) => [r.id, r]));
  return rows.map((r) => {
    const rate = rateById.get(r.id);
    return {
      company: r.company,
      name: r.name,
      sku: r.sku,
      urduName: r.urduName ?? "",
      category: r.category ?? "",
      brand: r.brand ?? "",
      taxable: r.taxable ? "yes" : "no",
      isActive: r.isActive ? "yes" : "no",
      purchaseRate1: rate?.purchaseRate1 ?? "",
      purchaseRate2: rate?.purchaseRate2 ?? "",
      purchaseRate3: rate?.purchaseRate3 ?? "",
      salesRate: rate?.salesRate ?? "",
    };
  });
}

// Rows come from the browser already parsed (lib/csv.ts runs on both sides), so
// this takes objects rather than a file. Nothing is written until every row
// passes: half an imported price list is worse than none, because you can't tell
// by looking which half landed.
export async function importProductsCsv(
  rows: Record<string, string>[],
): Promise<{ error?: string; created?: number }> {
  return guard("Couldn't import the products.", async () => {
  const session = await getLiveSession();
  requirePermission(session, "products", "create");
  if (rows.length === 0) return { error: "That file has no rows." };

  // Fetched once for the whole file. A category or brand that matches one of
  // these arrives as an id, so createProductsBatch's transaction does no lookup
  // for it — the same two lookups per row are what made a long file crawl
  // against a database ~170ms away. A name that matches nothing still goes down
  // as text and is created inside that transaction, as before.
  const [companyRows, categoryRows, brandRows] = await Promise.all([getCompanies(), getCategories(), getBrands()]);
  const key = (s: string) => s.trim().toLowerCase();
  const companyByName = new Map(companyRows.map((c) => [key(c.name), c.id]));
  const categoryByName = new Map(categoryRows.map((c) => [key(c.name), c.id]));
  const brandByName = new Map(brandRows.map((b) => [key(b.name), b.id]));

  const errors: string[] = [];
  const batch: ProductBatchRow[] = [];

  rows.forEach((r, i) => {
    // +2, not +1: row 1 of the file is the heading.
    const label = `Row ${i + 2}`;
    const name = (r.name ?? "").trim();
    const company = (r.company ?? "").trim();
    const companyId = companyByName.get(key(company));

    if (!name) errors.push(`${label}: Item Name is required.`);
    if (!company) errors.push(`${label}: Company is required.`);
    else if (!companyId) errors.push(`${label}: no company named "${company}" — check the spelling.`);
    if (!name || !companyId) return;

    batch.push({
      name,
      sku: (r.sku ?? "").trim(),
      companyId,
      categoryId: categoryByName.get(key(r.category ?? "")) ?? null,
      brandId: brandByName.get(key(r.brand ?? "")) ?? null,
      categoryName: (r.category ?? "").trim(),
      brandName: (r.brand ?? "").trim(),
      urduName: (r.urduName ?? "").trim() || null,
      taxable: csvBool(r.taxable ?? "", false),
      isActive: csvBool(r.isActive ?? "", true),
    });
  });

  if (errors.length > 0) return { error: csvErrorText(errors) };

  const result = await createProductsBatch(batch);
  if (result.error) return { error: result.error };
  return { created: result.created?.length ?? 0 };
  });
}
