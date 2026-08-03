import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { documentTypes } from "@/lib/db/schema";
import { documentScope, nextSequenceValue } from "@/lib/db/sequences";
import { CACHE, getDocumentTypes, invalidateLookups } from "@/lib/queries/lookups";

// Numbers come from the counter in number_sequences, one per series and shared by
// every company (see documentScope), and document_number_ledger records each one
// that gets issued (it is never deleted from, so a deleted document's number is
// never handed out again).
//
// This replaced COUNT(document_number_ledger) + 1, which had two problems: it
// scanned the company's whole numbering history on every create, and counting
// then inserting is not atomic — two concurrent invoices read the same count and
// both became SI-0007. The counter increments and returns in a single statement.
//
// Pass the transaction that will write the document. The allocation then commits
// or rolls back with it, so a failed create returns its number rather than
// leaving a permanent gap in the sequence.
export async function nextDocumentNumber(series: string, tx?: Parameters<Parameters<typeof db.transaction>[0]>[0]) {
  const value = await nextSequenceValue(documentScope(series), tx ?? db);
  return `${series}-${String(value).padStart(4, "0")}`;
}

// Sales invoices and payments use fixed, never-user-configured document types,
// so both had their own find-then-create pair. That was a guaranteed round trip
// before every create; the list is cached, so the common case is now free.
//
// The fallback is an upsert rather than a plain insert on purpose: the cache
// could be a moment stale, and (company_id, code) is unique, so a blind insert
// would fail where this returns the existing row. DO UPDATE writes code back to
// the value it already has — it exists only so RETURNING yields a row on
// conflict.
export async function ensureDocumentType(values: typeof documentTypes.$inferInsert) {
  const known = await getDocumentTypes();
  const hit = known.find((t) => t.companyId === values.companyId && t.code === values.code);
  if (hit) return hit;

  const [row] = await db
    .insert(documentTypes)
    .values(values)
    .onConflictDoUpdate({
      target: [documentTypes.companyId, documentTypes.code],
      set: { code: sql`excluded.code` },
    })
    .returning();

  // The list this function reads from is now one row out of date.
  invalidateLookups(CACHE.documentTypes);
  return row;
}
