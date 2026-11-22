import type { Row } from "./table";

export function matchesStockSetup(row: Row, setup: string, base: string, rule: string, quantity = ""): boolean {
  const incomplete = row._missingCategory === true || row._hasBaseUnit !== true || row._hasUnitRule !== true;
  if (setup === "incomplete" && !incomplete || setup === "complete" && incomplete) return false;
  if (setup === "category" && row._missingCategory !== true) return false;
  if (base === "missing" && row._hasBaseUnit === true) return false;
  if (base && base !== "missing" && row._baseUnitId !== base) return false;
  const rules = String(row._ruleIds ?? "").split(",").filter(Boolean);
  if (rule === "missing" && rules.length > 0) return false;
  if (rule && rule !== "missing" && !rules.includes(rule)) return false;
  const onHand = Number(row._stockQuantity ?? 0);
  if (quantity === "zero" && onHand !== 0 || quantity === "positive" && onHand <= 0 || quantity === "negative" && onHand >= 0) return false;
  return true;
}
