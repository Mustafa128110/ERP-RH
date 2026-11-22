import "server-only";
import {db} from "@/lib/db";
import {documentScope,nextSequenceRange,nextSequenceValue} from "@/lib/db/sequences";
// Pure transactional numbering: query helpers must not import session lookups.
export async function nextDocumentNumber(series: string, tx?: Parameters<Parameters<typeof db.transaction>[0]>[0]) {
  const value = await nextSequenceValue(documentScope(series), tx ?? db);
  return `${series}-${String(value).padStart(4, "0")}`;
}

export async function nextDocumentNumberRange(series: string, count: number, tx?: Parameters<Parameters<typeof db.transaction>[0]>[0]) {
  const values = await nextSequenceRange(documentScope(series), count, tx ?? db);
  return values.map((value) => `${series}-${String(value).padStart(4, "0")}`);
}
