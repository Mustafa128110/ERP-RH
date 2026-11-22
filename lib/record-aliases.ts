const REFERENCE_FIELDS = new Set(["argument", "id", "companyId", "itemId", "itemIds", "documentTypeId", "expenseCategoryId", "survivorId"]);

// Old browser drafts and queued creates can still carry an M52/product ID.
// Rewrite references only, never notes, names, operation IDs or revision tokens.
export function rewriteRecordAliases(value: unknown, aliases: ReadonlyMap<string, string>, field = "argument"): unknown {
  if (typeof value === "string") return REFERENCE_FIELDS.has(field) ? aliases.get(value) ?? value : value;
  if (value instanceof FormData) {
    const copy = new FormData();
    for (const [key, entry] of value.entries()) {
      if (typeof entry === "string" && key.endsWith("Json")) {
        try { copy.set(key, JSON.stringify(rewriteRecordAliases(JSON.parse(entry), aliases))); }
        catch { copy.set(key, entry); }
      } else copy.set(key, typeof entry === "string" ? String(rewriteRecordAliases(entry, aliases, key)) : entry);
    }
    return copy;
  }
  if (Array.isArray(value)) return value.map((entry) => rewriteRecordAliases(entry, aliases, field));
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, rewriteRecordAliases(entry, aliases, key)]));
  return value;
}
