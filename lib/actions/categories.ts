"use server";

import { eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { categories } from "@/lib/db/schema";
import { getLiveSession, getSession } from "@/lib/auth/session";
import { requirePermission } from "@/lib/auth/permissions";
import { CACHE, invalidateLookups } from "@/lib/queries/lookups";
import { slugify } from "@/lib/format";
import { guard, type ActionResult, type CreateResult } from "@/lib/actions/guard";
import { recordAudit } from "@/lib/actions/audit";

export interface CategoryNode {
  id: string;
  name: string;
  slug: string | null;
  parentId: string | null;
  children: CategoryNode[];
}

export async function listCategoryTree(): Promise<CategoryNode[]> {
  const session = await getSession();
  requirePermission(session, "categories", "view");

  const rows = await db
    .select({
      id: categories.id,
      name: categories.name,
      slug: categories.slug,
      parentId: categories.parentId,
      sortOrder: categories.sortOrder,
    })
    .from(categories)
    .orderBy(categories.sortOrder, categories.name);

  const byId = new Map<string, CategoryNode>(rows.map((r) => [r.id, { id: r.id, name: r.name, slug: r.slug, parentId: r.parentId, children: [] }]));
  const roots: CategoryNode[] = [];
  // rows are already sorted by (sortOrder, name), so children/roots keep that order.
  for (const r of rows) {
    const node = byId.get(r.id)!;
    if (r.parentId && byId.has(r.parentId)) {
      byId.get(r.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

// Walks parent links to see whether `items` describes a tree or a ring. Postgres
// is perfectly happy to store A→B→A; every reader that recurses is not, and the
// category tree renders by recursion. Cheap to check here, impossible to
// untangle once written.
function hasCycle(items: { id: string; parentId: string | null }[]): boolean {
  const parentOf = new Map(items.map((i) => [i.id, i.parentId]));
  for (const start of parentOf.keys()) {
    const seen = new Set<string>([start]);
    for (let at = parentOf.get(start); at; at = parentOf.get(at) ?? null) {
      if (seen.has(at)) return true;
      seen.add(at);
    }
  }
  return false;
}

// Persist the drag-and-drop tree: each category's parent and sibling order.
//
// One statement, not one per row. This used to loop `UPDATE … WHERE id = $1`
// inside a transaction, and every statement in a transaction is its own round
// trip to a database ~170ms away — reordering forty categories cost about seven
// seconds of nothing but latency. `UPDATE … FROM (VALUES …)` does the whole tree
// in a single trip, and is still atomic without an explicit transaction.
export async function saveCategoryTree(
  items: { id: string; parentId: string | null; sortOrder: number }[],
): Promise<ActionResult> {
  return guard("Couldn't save the category order.", async () => {
    const session = await getLiveSession();
    requirePermission(session, "categories", "edit");

    if (items.length === 0) return { success: true };
    if (items.some((i) => i.parentId === i.id)) return { error: "A category can't be its own parent." };
    if (hasCycle(items)) return { error: "That move would put a category inside itself." };

    // Every value is cast: a VALUES list arrives as untyped parameters, and
    // Postgres has to be told that a NULL parent is a NULL uuid.
    const values = sql.join(
      items.map((i) => sql`(${i.id}::uuid, ${i.parentId}::uuid, ${i.sortOrder}::int)`),
      sql`, `,
    );
    await db.execute(sql`
      UPDATE categories AS c
      SET parent_id = v.parent_id, sort_order = v.sort_order
      FROM (VALUES ${values}) AS v(id, parent_id, sort_order)
      WHERE c.id = v.id
    `);

    invalidateLookups(CACHE.categories);
    revalidatePath("/inventory/categories");
    await recordAudit({ action: "update", entity: "category tree", summary: `${items.length} categories reordered` });
    return { success: true };
  });
}

export async function getCategory(categoryId: string) {
  const session = await getSession();
  requirePermission(session, "categories", "view");
  const [row] = await db.select().from(categories).where(eq(categories.id, categoryId)).limit(1);
  return row ?? null;
}

function readCategoryForm(formData: FormData) {
  const parentIdRaw = String(formData.get("parentId") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  return {
    name,
    slug: slugify(name) || null,
    parentId: parentIdRaw === "" || parentIdRaw === "none" ? null : parentIdRaw,
  };
}

export interface CategoryBatchRow {
  name: string;
  parentId: string | null;
}

export async function createCategoriesBatch(rows: CategoryBatchRow[]): Promise<CreateResult<{ id: string; name: string }>> {
  return guard("Can't create — a category with the same slug already exists.", async () => {
    const session = await getLiveSession();
    requirePermission(session, "categories", "create");

    const valid = rows.filter((r) => r.name.trim());
    if (valid.length === 0) return { error: "Add at least one category with a name." };

    const created = await db
      .insert(categories)
      .values(valid.map((r) => ({ name: r.name.trim(), slug: slugify(r.name) || null, parentId: r.parentId })))
      .returning({ id: categories.id, name: categories.name });

    invalidateLookups(CACHE.categories);
    revalidatePath("/inventory/categories");
    await recordAudit({ action: "create", entity: "category", summary: valid.map((r) => r.name).join(", ") });
    return { created };
  });
}

export async function updateCategory(categoryId: string, _prevState: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  return guard("Couldn't save the category.", async () => {
    const session = await getLiveSession();
    requirePermission(session, "categories", "edit");

    const values = readCategoryForm(formData);
    if (!values.name) return { error: "Name is required." };
    if (values.parentId === categoryId) return { error: "A category can't be its own parent." };

    await db.update(categories).set(values).where(eq(categories.id, categoryId));
    invalidateLookups(CACHE.categories);
    revalidatePath("/inventory/categories");
    await recordAudit({ action: "update", entity: "category", entityId: categoryId, summary: values.name });
    return { success: true };
  });
}

export async function deleteCategory(_prevState: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  return guard("Can't delete — this category has child categories or items still referencing it.", async () => {
    const session = await getLiveSession();
    requirePermission(session, "categories", "delete");

    const categoryId = String(formData.get("categoryId") ?? "");
    await db.delete(categories).where(eq(categories.id, categoryId));

    invalidateLookups(CACHE.categories);
    revalidatePath("/inventory/categories");
    await recordAudit({ action: "delete", entity: "category", entityId: categoryId, summary: categoryId });
    return { success: true };
  });
}
