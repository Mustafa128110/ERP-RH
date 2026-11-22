import "server-only";
import { inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { consolidationHistory } from "@/lib/db/schema";
import { cached, MINUTE } from "@/lib/cache";
import { rewriteRecordAliases } from "@/lib/record-aliases";

export async function resolveArchivedArguments(args: unknown[]): Promise<unknown[]> {
  const rows = await cached("consolidation_history", 5 * MINUTE, () => db.select({ from: consolidationHistory.sourceId, to: consolidationHistory.targetId }).from(consolidationHistory).where(inArray(consolidationHistory.kind, ["company", "merged product", "document type", "expense category"])));
  const aliases = new Map(rows.filter((row): row is { from: string; to: string } => row.to !== null).map((row) => [row.from, row.to]));
  return args.map((arg) => rewriteRecordAliases(arg, aliases));
}
