import "server-only";
import { and, eq, inArray, type Column, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  bankAccounts,
  brands,
  cashAccounts,
  categories,
  chequeRegister,
  companies,
  contacts,
  documentTypes,
  expenseCategories,
  expenses,
  items,
  locations,
  roles,
  taxes,
  unitConversions,
  units,
} from "@/lib/db/schema";
import { getSession } from "@/lib/auth/session";
import { PermissionError } from "@/lib/auth/permissions";
import { companyInScope, getScopeCompanyIds } from "@/lib/auth/scope";
import { cached, invalidate, MINUTE } from "@/lib/cache";
import { bankAccountLabel } from "@/lib/account-label";
import { CACHE } from "@/lib/cache-keys";
import { settingsForCompanies } from "@/lib/queries/settings";
import { queryItemOptions } from "@/lib/queries/item-options";
export { CACHE, READ_DOMAIN } from "@/lib/cache-keys";

// Dropdown option lists. Nearly forty near-identical copies of these were spread
// across lib/actions/* — nine separate functions selected the full companies
// table alone — and they picked up two problems along the way.
//
// First, they lived in "use server" modules, which publishes every export as an
// HTTP endpoint. About thirty shipped with no auth check whatsoever, so an
// unauthenticated POST could dump the contact list, the cheque register, or the
// bank accounts. Everything here requires a live session.
//
// The gate is authentication, deliberately not a module permission: a Salesman
// holds sales.create but not companies.view, products.view, or units.view, and
// still has to fill in the new-sale form. Authorization for what a user *does*
// with this data already sits on the action that does it (createSale requires
// sales.create); re-gating the option lists would only break the form.
//
// Second, none of it was cached. These are reference tables — companies, units,
// currencies — that change a few times a year, and every render paid a ~170ms
// round trip for each. They now sit behind lib/cache.ts, with the auth check
// kept strictly outside the cached scope: the *data* is global, the permission
// to see it is not, so caching the query must never cache the check.
//
// Every write to one of these tables calls the matching invalidate below, so
// creating a brand and immediately opening a product form shows the new brand.

const TTL = 5 * MINUTE;

// Key names match the table they read, so invalidation reads as itself. Grouped
// here rather than inlined as strings so a typo is a type error, not a cache
// entry that never clears.
export function invalidateLookups(...keys: (typeof CACHE)[keyof typeof CACHE][]) {
  // Every dashboard figure and every report row is derived from tables the
  // keys above guard, so any write that busts a lookup busts the aggregates
  // too — a sale that changes "Today's Sales" must show the moment the page is
  // next opened. The coverage rule in lib/cache.check.ts holds every mutating
  // action to calling this, which is what makes the two extra invalidations
  // here safe to rely on. The one writer this misses is settlement.ts (it
  // takes a transaction handle, not a request); its callers all invalidate
  // after commit, which lands here.
  //
  // The page reads are deliberately NOT dropped here. This used to clear the
  // whole `page_reads:` prefix, which meant one contact rename cost every list
  // on every screen — for every user and every company scope — its cache entry,
  // and the cache was never warm for anything. Writers now name the domains they
  // can actually change through invalidateReads below.
  invalidate(...keys, CACHE.dashboard, CACHE.reports);
}

// The cached list reads a write can change (lib/cache-keys.ts holds what each one
// selects). Defined in lib/read-cache.ts beside the function that builds the keys
// and re-exported here, so an action file needs one import line for both halves of
// its invalidation.
//
// Separate from invalidateLookups rather than folded into it because the two
// answer different questions: which reference lists this write changed, and which
// screens' lists it changed. Most writes touch a different set of each.
export { invalidateReads } from "@/lib/read-cache";

async function requireAuth() {
  const session = await getSession();
  if (!session) throw new PermissionError("Not authenticated");
  return session;
}

// The set of companies currently in view, as a stable cache-key fragment. A
// Royal-Hardware view and an M52 view must not share a cache entry, so the
// scope is baked into every scoped lookup's key. invalidateLookups still clears
// them all — invalidate() drops a key and every "<key>:…" variant.
//
// The dashboard and report caches (lib/actions/dashboard.ts,
// lib/actions/reports.ts) key themselves on this same fragment, so one scope
// means one entry per aggregate, cleared by the same invalidate().
export async function scopeSuffix(): Promise<string> {
  const ids = await getScopeCompanyIds();
  return ids.length ? [...ids].sort().join(",") : "none";
}

// Unscoped lookup — for reference data with no company at all (units, roles).
// One shared entry for everyone.
function lookup<T>(key: string, load: () => Promise<T>): () => Promise<T> {
  return async () => {
    await requireAuth();
    return cached(key, TTL, load);
  };
}

// Scoped lookup — the query is filtered to the companies in view plus global
// rows, and cached per scope. `column` is the table's company_id; the load
// receives the ready-made scope condition to drop into its `.where()`.
function scopedLookup<T>(key: string, column: Column, load: (scope: SQL | undefined) => Promise<T>): () => Promise<T> {
  return async () => {
    await requireAuth();
    const [suffix, where] = await Promise.all([scopeSuffix(), companyInScope(column)]);
    return cached(`${key}:${suffix}`, TTL, () => load(where));
  };
}

// Companies the user can assign to — the accessible set, not the current view
// scope. You can file a record under any company you have access to regardless
// of which one you're looking at, so this ignores the Topbar selection.
export const getCompanies = async () => {
  const session = await requireAuth();
  const ids = session.companyIds;
  return cached(`${CACHE.companies}:${ids.length ? [...ids].sort().join(",") : "none"}`, TTL, () =>
    ids.length ? db.select().from(companies).where(inArray(companies.id, ids)) : Promise.resolve([]),
  );
};

// Global reference data — brands, categories, currencies, locations, units,
// taxes, roles have no company_id, so they're the same for everyone and share
// one cache entry regardless of the Topbar scope.
export const getCategories = lookup(CACHE.categories, () => db.select().from(categories));
export const getBrands = lookup(CACHE.brands, () => db.select().from(brands));
export const getLocations = lookup(CACHE.locations, () => db.select().from(locations));
export const getUnits = lookup(CACHE.units, () => db.select().from(units));
export const getTaxes = lookup(CACHE.taxes, () => db.select().from(taxes).where(eq(taxes.isActive, true)));
export const getRoles = lookup(CACHE.roles, () => db.select().from(roles));

export const getUnitConversionOptions = lookup(`${CACHE.items}:unit-conversions`, () =>
  db
    .select({
      itemId: unitConversions.itemId,
      fromUnitId: unitConversions.fromUnitId,
      toUnitId: unitConversions.toUnitId,
      multiplier: unitConversions.multiplier,
    })
    .from(unitConversions),
);

// Still company-scoped: document types and expense categories belong to a company.
export const getDocumentTypes = scopedLookup(CACHE.documentTypes, documentTypes.companyId, (w) => db.select().from(documentTypes).where(w));
export const getExpenseCategories = scopedLookup(CACHE.expenseCategories, expenseCategories.companyId, (w) =>
  db.select().from(expenseCategories).where(w),
);

// `rate` is what the item last cost landed — the purchase price plus its share
// of that delivery's shipping, discount and tax, read from the rate_list view
// (purchase_rate_1, see drizzle/0049). The sale grid shows it as the reference
// price beside the price actually charged, and freight is part of what the goods
// cost: quoting the bare invoice price there is how a sale ends up under water.
//
// Products and both latest-rate sets are read in one statement. The grouped
// query lives in lib/queries/item-options.ts so its real SQL is runnable from a
// database check without importing this session-aware lookup module.
export const getItemOptions = scopedLookup(CACHE.items, items.companyId, queryItemOptions);

export const getContactOptions = scopedLookup(`${CACHE.contacts}:options`, contacts.companyId, (w) =>
  db.select({ id: contacts.id, displayName: contacts.displayName, companyId: contacts.companyId }).from(contacts).where(w),
);

export const getBankAccountOptions = scopedLookup(CACHE.bankAccounts, bankAccounts.companyId, async (w) => {
  const rows = await db
    .select({
      id: bankAccounts.id,
      companyId: bankAccounts.companyId,
      bankName: bankAccounts.bankName,
      branchName: bankAccounts.branchName,
      accountTitle: bankAccounts.accountTitle,
    })
    .from(bankAccounts)
    .where(and(eq(bankAccounts.isActive, true), w));
  // Bank, branch and account title together (lib/account-label.ts). Bank and
  // branch alone can't tell two accounts at the same branch apart, which is
  // exactly the case a shop with a current and a savings account is in.
  //
  // companyId rides along for the pickers that narrow to one company — null is
  // global, visible to every company (lib/contact-scope.ts).
  return rows.map((r) => ({ id: r.id, companyId: r.companyId, name: bankAccountLabel(r) }));
});

// companyId comes along so a form can narrow the list to the company being
// filed under — a sale must not settle into another company's drawer.
export const getCashAccountOptions = scopedLookup(CACHE.cashAccounts, cashAccounts.companyId, (w) =>
  db
    .select({ id: cashAccounts.id, name: cashAccounts.name, companyId: cashAccounts.companyId, isDefault: cashAccounts.isDefault })
    .from(cashAccounts)
    .where(and(eq(cashAccounts.isActive, true), w)),
);

// A cheque is available if it isn't already settling a document (payments,
// stock purchases — linked via cheque_register.document_id) or an expense
// (linked via expenses.cheque_id, since expenses aren't part of the
// documents universal model) — except whichever one is currently being
// edited, so it doesn't disappear from its own dropdown.
//
// The source does not depend on which document is being edited — only the
// filtering below does — so one cache entry serves every caller and the
// "except the one I'm editing" case costs nothing extra.
const chequeSource = (scope: SQL | undefined) =>
  db
    .select({
      id: chequeRegister.id,
      chequeNumber: chequeRegister.chequeNumber,
      amount: chequeRegister.amount,
      documentId: chequeRegister.documentId,
      companyId: chequeRegister.companyId,
      expenseId: expenses.id,
    })
    .from(chequeRegister)
    .leftJoin(expenses, and(eq(expenses.chequeId, chequeRegister.id), eq(expenses.status, "posted")))
    .where(scope);

export async function getAvailableCheques(documentId?: string, expenseId?: string) {
  await requireAuth();
  const [suffix, where] = await Promise.all([scopeSuffix(), companyInScope(chequeRegister.companyId)]);
  const allCheques = await cached(`${CACHE.cheques}:${suffix}`, TTL, () => chequeSource(where));

  return allCheques
    .filter((cheque) => !(cheque.documentId && cheque.documentId !== documentId) && !(cheque.expenseId && cheque.expenseId !== expenseId))
    .map((c) => ({ id: c.id, name: `${c.chequeNumber} (${c.amount})`, companyId: c.companyId }));
}

const labelled = {
  contact: (c: { id: string; displayName: string; companyId: string | null }) => ({ id: c.id, name: c.displayName, companyId: c.companyId ?? "" }),
  // Name only — the SKU used to be appended here, which put it in front of the
  // customer on every sale line and, worse, made the label the string the server
  // resolved items by. Nothing picks an item by SKU on a sale.
  item: (i: { id: string; name: string; sku: string; companyId: string; baseUnitId: string | null; taxable: boolean | null; rate: string | null; salesRate: string | null }) => ({
    id: i.id,
    name: i.name,
    companyId: i.companyId,
    rate: i.rate,
    salesRate: i.salesRate,
    baseUnitId: i.baseUnitId,
    taxable: i.taxable ?? false,
  }),
  unit: (u: { id: string; name: string; symbol: string | null }) => ({ id: u.id, name: u.symbol ? `${u.name} (${u.symbol})` : u.name }),
};

// The new-sale and edit-sale routes need an identical eleven option lists, and
// each was re-deriving the same display labels inline. One shape, one place, so
// the two can't drift.
export async function getSaleFormOptions(documentId?: string) {
  const companyPromise = getCompanies();
  const taxSettingsPromise = companyPromise.then((companies) =>
    settingsForCompanies(companies.map((company) => company.id), ["default_sales_tax_id", "tax_prices_include_tax"]),
  );
  const [companyOptions, customers, itemRows, unitRows, bankAccountOptions, cashAccountOptions, chequeOptions, taxOptions, conversionOptions, taxSettings] =
    await Promise.all([
      companyPromise,
      getContactOptions(),
      getItemOptions(),
      getUnits(),
      getBankAccountOptions(),
      getCashAccountOptions(),
      getAvailableCheques(documentId),
      getTaxes(),
      getUnitConversionOptions(),
      taxSettingsPromise,
    ]);

  return {
    companyOptions,
    customerOptions: customers.map(labelled.contact),
    itemOptions: itemRows.map(labelled.item),
    unitOptions: unitRows.map(labelled.unit),
    bankAccountOptions,
    cashAccountOptions,
    chequeOptions,
    taxOptions,
    conversionOptions,
    taxSettings,
  };
}

// Same idea for stock purchases: suppliers rather than customers, plus the
// document-type list that only the purchase form needs.
export async function getPurchaseFormOptions(documentId?: string) {
  const companyPromise = getCompanies();
  const taxSettingsPromise = companyPromise.then((companies) =>
    settingsForCompanies(companies.map((company) => company.id), ["default_purchase_tax_id", "tax_prices_include_tax"]),
  );
  const [companyOptions, suppliers, itemRows, documentTypeOptions, locationOptions, unitRows, bankAccountOptions, cashAccountOptions, chequeOptions, taxOptions, conversionOptions, taxSettings] =
    await Promise.all([
      companyPromise,
      getContactOptions(),
      getItemOptions(),
      getDocumentTypes(),
      getLocations(),
      getUnits(),
      getBankAccountOptions(),
      getCashAccountOptions(),
      getAvailableCheques(documentId),
      getTaxes(),
      getUnitConversionOptions(),
      taxSettingsPromise,
    ]);

  return {
    companyOptions,
    supplierOptions: suppliers.map(labelled.contact),
    itemOptions: itemRows.map(labelled.item),
    documentTypeOptions,
    locationOptions,
    unitOptions: unitRows.map(labelled.unit),
    bankAccountOptions,
    cashAccountOptions,
    chequeOptions,
    taxOptions,
    conversionOptions,
    taxSettings,
  };
}

// The one bundle the offline-readiness prep (lib/actions/offline.ts) fetches
// after login: the reference lists the three offline-supported workflows
// (quotation, expense, payment) need, in the exact shapes the pages seed into
// the client cache — so a cached option is byte-identical whether it came from
// a page visit or from the prep. Deliberately NOT the whole database: no
// documents, no balances, no stock — sales and stock stay server-required and
// their data is not prepared. The set is enforced by lib/offline-readiness.
// check.ts against the forms' useCachedOptions calls.
export async function getOfflineReadinessData() {
  const [companies, customers, itemRows, units, expenseCategories, contacts, bankAccounts, cashAccounts, cheques] =
    await Promise.all([
      getCompanies(),
      getContactOptions(),
      getItemOptions(),
      getUnits(),
      getExpenseCategories(),
      getContactOptions(),
      getBankAccountOptions(),
      getCashAccountOptions(),
      getAvailableCheques(),
    ]);

  return {
    companies,
    customers: customers.map(labelled.contact),
    items: itemRows.map(labelled.item),
    units: units.map(labelled.unit),
    expenseCategories: expenseCategories.map((c) => ({ id: c.id, name: c.name, companyId: c.companyId })),
    contacts: contacts.map((c) => ({ id: c.id, name: c.displayName, companyId: c.companyId ?? "" })),
    bankAccounts,
    cashAccounts,
    cheques,
  };
}
