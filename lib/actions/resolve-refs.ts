import "server-only";
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { PermissionError } from "@/lib/auth/permissions";
import { db } from "@/lib/db";
import { items, units, contacts, expenseCategories, categories, brands, locations } from "@/lib/db/schema";
import { nextSequenceRange, nextSequenceValue, formatSku, SKU_SCOPE } from "@/lib/db/sequences";
import { slugify, toTitleCase } from "@/lib/format";

// Resolvers for line pickers that accept free-typed text: if an id is already
// chosen, use it; otherwise a non-empty typed name creates a name-only record
// (the rest of its fields stay empty, which is what marks it "incomplete" in the
// master-data lists). A blank id and blank name means the field was left empty.
// All run inside the sale/purchase transaction, so a rollback undoes the
// on-the-fly creates too.

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function resolveItemId(tx: Tx, companyId: string, id: string | null, name: string | null): Promise<string | null> {
  if (id) {
    // A submitted id is untrusted: catalogs are per company (items.company_id
    // is NOT NULL), so an id must point at a row of THIS company or the
    // document would book stock against another set of books with nothing
    // saying so. Refuse rather than silently substitute.
    const [existing] = await tx.select({ id: items.id }).from(items).where(and(eq(items.id, id), eq(items.companyId, companyId))).limit(1);
    if (existing) return existing.id;
    throw new PermissionError("This item doesn't belong to this company — pick one from this company's catalog.");
  }
  const n = toTitleCase(name);
  if (!n) return null;
  const [existing] = await tx
    .select({ id: items.id })
    .from(items)
    .where(and(eq(items.companyId, companyId), eq(items.name, n)))
    .limit(1);
  if (existing) return existing.id;
  const sku = formatSku(await nextSequenceValue(SKU_SCOPE, tx));
  const [row] = await tx.insert(items).values({ companyId, name: n, sku }).returning({ id: items.id });
  return row.id;
}

export async function resolveUnitId(tx: Tx, id: string | null, name: string | null): Promise<string | null> {
  if (id) return id;
  const n = toTitleCase(name);
  if (!n) return null;
  const [existing] = await tx.select({ id: units.id }).from(units).where(eq(units.name, n)).limit(1);
  if (existing) return existing.id;
  const [row] = await tx.insert(units).values({ name: n }).returning({ id: units.id });
  return row.id;
}

// Set-based line-grid counterparts. They deliberately return ids in input
// order, so callers can construct one multi-row document_lines insert without
// any statement inside their line loop.
export async function resolveItemIds(
  tx: Tx,
  rows: { companyId: string; itemId: string | null; itemName: string | null }[],
): Promise<(string | null)[]> {
  const key = (companyId: string, name: string) => JSON.stringify([companyId, name]);
  const chosenIds = [...new Set(rows.map((row) => row.itemId).filter((id): id is string => Boolean(id)))];
  const chosen = chosenIds.length
    ? await tx.select({ id: items.id, companyId: items.companyId }).from(items).where(inArray(items.id, chosenIds))
    : [];
  const chosenById = new Map(chosen.map((row) => [row.id, row.companyId]));
  for (const row of rows) {
    if (row.itemId && chosenById.get(row.itemId) !== row.companyId) {
      throw new PermissionError("This item doesn't belong to this company — pick one from this company's catalog.");
    }
  }

  const wanted = new Map<string, { companyId: string; name: string }>();
  for (const row of rows) {
    const name = toTitleCase(row.itemName);
    if (!row.itemId && name) wanted.set(key(row.companyId, name), { companyId: row.companyId, name });
  }
  const pairs = [...wanted.values()];
  const found = pairs.length
    ? await tx
        .select({ id: items.id, companyId: items.companyId, name: items.name })
        .from(items)
        .where(and(inArray(items.companyId, pairs.map((pair) => pair.companyId)), inArray(items.name, pairs.map((pair) => pair.name))))
    : [];
  const byName = new Map(found.map((row) => [key(row.companyId, row.name), row.id]));
  const missing = pairs.filter((pair) => !byName.has(key(pair.companyId, pair.name)));
  if (missing.length > 0) {
    const skuValues = await nextSequenceRange(SKU_SCOPE, missing.length, tx);
    const inserted = await tx
      .insert(items)
      .values(missing.map((row, index) => ({ ...row, sku: formatSku(skuValues[index]!) })))
      .returning({ id: items.id, companyId: items.companyId, name: items.name });
    for (const row of inserted) byName.set(key(row.companyId, row.name), row.id);
  }

  return rows.map((row) => row.itemId ?? byName.get(key(row.companyId, toTitleCase(row.itemName))) ?? null);
}

export async function resolveUnitIds(tx: Tx, rows: { unitId: string | null; unitName: string | null }[]): Promise<(string | null)[]> {
  const names = [...new Set(rows.filter((row) => !row.unitId).map((row) => toTitleCase(row.unitName)).filter((name): name is string => Boolean(name)))];
  const found = names.length ? await tx.select({ id: units.id, name: units.name }).from(units).where(inArray(units.name, names)) : [];
  const byName = new Map(found.map((row) => [row.name, row.id]));
  const missing = names.filter((name) => !byName.has(name));
  if (missing.length > 0) {
    const inserted = await tx.insert(units).values(missing.map((name) => ({ name }))).returning({ id: units.id, name: units.name });
    for (const row of inserted) byName.set(row.name, row.id);
  }
  return rows.map((row) => row.unitId ?? byName.get(toTitleCase(row.unitName)) ?? null);
}

// Categories and brands are global reference data — no company argument, unlike
// items and contacts. A category typed here is created top-level; nest it later
// from the category tree if it belongs under something.
export async function resolveCategoryId(tx: Tx, id: string | null, name: string | null): Promise<string | null> {
  if (id) return id;
  const n = toTitleCase(name);
  if (!n) return null;
  const [existing] = await tx.select({ id: categories.id }).from(categories).where(eq(categories.name, n)).limit(1);
  if (existing) return existing.id;
  // categories.slug is UNIQUE and two different names can slugify the same way
  // ("Hand Tools" / "hand-tools"), so a colliding slug falls back to no slug
  // rather than failing the create — the name is what the pickers show.
  const slug = slugify(n) || null;
  const [clash] = slug ? await tx.select({ id: categories.id }).from(categories).where(eq(categories.slug, slug)).limit(1) : [];
  const [row] = await tx.insert(categories).values({ name: n, slug: clash ? null : slug }).returning({ id: categories.id });
  return row.id;
}

export async function resolveBrandId(tx: Tx, id: string | null, name: string | null): Promise<string | null> {
  if (id) return id;
  const n = toTitleCase(name);
  if (!n) return null;
  const [existing] = await tx.select({ id: brands.id }).from(brands).where(eq(brands.name, n)).limit(1);
  if (existing) return existing.id;
  const [row] = await tx.insert(brands).values({ name: n }).returning({ id: brands.id });
  return row.id;
}

// Locations are global, like categories and brands. Unlike them, a location has
// a NOT NULL type, so a name on its own isn't a complete record — it's created
// as a warehouse, which is where purchased goods arrive, and left without a
// code. That missing code is what marks it incomplete in the locations list, the
// same way a missing symbol marks a unit typed into a sale line.
export async function resolveLocationId(tx: Tx, id: string | null, name: string | null): Promise<string | null> {
  if (id) return id;
  const n = toTitleCase(name);
  if (!n) return null;
  const [existing] = await tx.select({ id: locations.id }).from(locations).where(eq(locations.name, n)).limit(1);
  if (existing) return existing.id;
  const [row] = await tx.insert(locations).values({ name: n, locationType: "warehouse" }).returning({ id: locations.id });
  return row.id;
}

export async function resolveExpenseCategoryId(tx: Tx, companyId: string, id: string | null, name: string | null): Promise<string | null> {
  if (id) {
    const [existing] = await tx
      .select({ id: expenseCategories.id })
      .from(expenseCategories)
      .where(and(eq(expenseCategories.id, id), eq(expenseCategories.companyId, companyId)))
      .limit(1);
    if (existing) return existing.id;
    throw new PermissionError("This expense category doesn't belong to this company — pick one from this company's list.");
  }
  const n = toTitleCase(name);
  if (!n) return null;
  const [existing] = await tx
    .select({ id: expenseCategories.id })
    .from(expenseCategories)
    .where(and(eq(expenseCategories.companyId, companyId), eq(expenseCategories.name, n)))
    .limit(1);
  if (existing) return existing.id;
  const [row] = await tx.insert(expenseCategories).values({ companyId, name: n }).returning({ id: expenseCategories.id });
  return row.id;
}

// Batch counterpart: validate all submitted ids together, fetch every typed
// name together, then insert every missing name together. Its statement count
// is constant whether the expense grid contains two rows or two hundred.
export async function resolveExpenseCategoryIds(
  tx: Tx,
  rows: { companyId: string; expenseCategoryId: string | null; expenseCategoryName: string | null }[],
): Promise<(string | null)[]> {
  const key = (companyId: string, value: string) => JSON.stringify([companyId, value]);
  const chosenIds = [...new Set(rows.map((row) => row.expenseCategoryId).filter((id): id is string => Boolean(id)))];
  const chosen = chosenIds.length
    ? await tx.select({ id: expenseCategories.id, companyId: expenseCategories.companyId }).from(expenseCategories).where(inArray(expenseCategories.id, chosenIds))
    : [];
  const chosenById = new Map(chosen.map((row) => [row.id, row.companyId]));
  for (const row of rows) {
    if (row.expenseCategoryId && chosenById.get(row.expenseCategoryId) !== row.companyId) {
      throw new PermissionError("This expense category doesn't belong to this company — pick one from this company's list.");
    }
  }

  const wanted = new Map<string, { companyId: string; name: string }>();
  for (const row of rows) {
    const name = toTitleCase(row.expenseCategoryName);
    if (!row.expenseCategoryId && name) wanted.set(key(row.companyId, name), { companyId: row.companyId, name });
  }
  const pairs = [...wanted.values()];
  const found = pairs.length
    ? await tx
        .select({ id: expenseCategories.id, companyId: expenseCategories.companyId, name: expenseCategories.name })
        .from(expenseCategories)
        .where(and(inArray(expenseCategories.companyId, pairs.map((pair) => pair.companyId)), inArray(expenseCategories.name, pairs.map((pair) => pair.name))))
    : [];
  const byName = new Map(found.map((row) => [key(row.companyId, row.name), row.id]));
  const missing = pairs.filter((pair) => !byName.has(key(pair.companyId, pair.name)));
  if (missing.length) {
    const inserted = await tx
      .insert(expenseCategories)
      .values(missing)
      .onConflictDoUpdate({ target: [expenseCategories.companyId, expenseCategories.name], set: { name: sql`excluded.name` } })
      .returning({ id: expenseCategories.id, companyId: expenseCategories.companyId, name: expenseCategories.name });
    for (const row of inserted) byName.set(key(row.companyId, row.name), row.id);
  }

  return rows.map((row) => row.expenseCategoryId ?? byName.get(key(row.companyId, toTitleCase(row.expenseCategoryName))) ?? null);
}

export async function resolveContactId(tx: Tx, companyId: string, id: string | null, name: string | null): Promise<string | null> {
  if (id) {
    // A submitted id is untrusted: a company-scoped contact belongs to its own
    // company (global ones serve every company). The name path below matches
    // exactly this predicate, so the id path must too — a forged or stale id
    // from another company's list is refused rather than attached to this
    // company's document.
    const [existing] = await tx
      .select({ id: contacts.id })
      .from(contacts)
      .where(and(eq(contacts.id, id), or(eq(contacts.companyId, companyId), isNull(contacts.companyId))))
      .limit(1);
    if (existing) return existing.id;
    throw new PermissionError("This contact doesn't belong to this company — pick one from this company's list.");
  }
  const n = toTitleCase(name);
  if (!n) return null;
  // This company's own contact first, then a global one (company_id IS NULL),
  // which every company can see. Matching only on company_id used to mint a
  // second, company-scoped copy of a global contact the first time it was named
  // in another company's sale or purchase — two rows for one supplier, with the
  // ledger balance split between them.
  const [existing] = await tx
    .select({ id: contacts.id, companyId: contacts.companyId })
    .from(contacts)
    .where(and(eq(contacts.displayName, n), or(eq(contacts.companyId, companyId), isNull(contacts.companyId))))
    .orderBy(sql`${contacts.companyId} IS NULL`)
    .limit(1);
  if (existing) return existing.id;
  const [row] = await tx.insert(contacts).values({ companyId, displayName: n }).returning({ id: contacts.id });
  return row.id;
}

// The set-based counterpart to resolveContactId, for batches that save as one
// multi-row INSERT. Calling resolveContactId per row would put a loop of round
// trips back inside the transaction — this is two statements whatever the row
// count: one SELECT for the names that already exist, one INSERT for the rest.
// Same preference as the single-row version: the company's own contact first, a
// global one after. Returns ids positionally aligned with `rows`.
export async function resolveContactIds(
  tx: Tx,
  rows: { companyId: string; contactId: string | null; contactName: string | null }[],
): Promise<(string | null)[]> {
  // Two companies can each have a contact of the same name, so the map key is
  // the pair, not the name.
  const key = (companyId: string, name: string) => JSON.stringify([companyId, name]);

  const wanted = new Map<string, { companyId: string; name: string }>();
  for (const r of rows) {
    const n = toTitleCase(r.contactName);
    if (!r.contactId && n) wanted.set(key(r.companyId, n), { companyId: r.companyId, name: n });
  }

  const resolved = new Map<string, string>();
  if (wanted.size > 0) {
    const pairs = [...wanted.values()];
    const found = await tx
      .select({ id: contacts.id, companyId: contacts.companyId, displayName: contacts.displayName })
      .from(contacts)
      .where(
        and(
          inArray(
            contacts.displayName,
            pairs.map((p) => p.name),
          ),
          or(
            inArray(
              contacts.companyId,
              pairs.map((p) => p.companyId),
            ),
            isNull(contacts.companyId),
          ),
        ),
      );

    for (const [k, p] of wanted) {
      const hit =
        found.find((c) => c.displayName === p.name && c.companyId === p.companyId) ??
        found.find((c) => c.displayName === p.name && c.companyId === null);
      if (hit) resolved.set(k, hit.id);
    }

    const missing = [...wanted].filter(([k]) => !resolved.has(k));
    if (missing.length > 0) {
      const inserted = await tx
        .insert(contacts)
        .values(missing.map(([, p]) => ({ companyId: p.companyId, displayName: p.name })))
        .returning({ id: contacts.id, companyId: contacts.companyId, displayName: contacts.displayName });
      for (const row of inserted) resolved.set(key(row.companyId ?? "", row.displayName), row.id);
    }
  }

  // A submitted id is untrusted the same way resolveContactId treats one: it
  // must point at this company's contact or a global one, or the whole batch
  // refuses. One SELECT for every distinct id, then the company predicate is
  // checked against each row's own company_id.
  const idsToCheck = [...new Set(rows.filter((r) => r.contactId).map((r) => `${r.companyId}|${r.contactId}`))].map((k) => {
    const [companyId, contactId] = k.split("|");
    return { companyId, contactId: contactId! };
  });
  if (idsToCheck.length > 0) {
    const found = await tx
      .select({ id: contacts.id, companyId: contacts.companyId })
      .from(contacts)
      .where(inArray(contacts.id, idsToCheck.map((i) => i.contactId)));
    const companyById = new Map(found.map((c) => [c.id, c.companyId]));
    for (const i of idsToCheck) {
      const company = companyById.get(i.contactId);
      // Missing row, or a company-scoped row that belongs elsewhere.
      if (company !== null && company !== i.companyId) {
        throw new PermissionError("This contact doesn't belong to this company — pick one from this company's list.");
      }
    }
  }

  return rows.map((r) => {
    if (r.contactId) return r.contactId;
    const n = toTitleCase(r.contactName);
    return n ? (resolved.get(key(r.companyId, n)) ?? null) : null;
  });
}
