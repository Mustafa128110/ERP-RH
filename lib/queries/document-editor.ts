import "server-only";
import { sql } from "drizzle-orm";
import { documents, documentLines, chequeRegister } from "@/lib/db/schema";

type EditorLine = Pick<typeof documentLines.$inferSelect, "itemId" | "locationId" | "unitId" | "quantity" | "unitPrice" | "unitCost" | "marketPurchase">;

// Header, version and children must come from the same statement snapshot.
// Parallel queries can pair new header versions with older line items, making
// an optimistic concurrency check accept input based on an inconsistent edit.
export const documentEditorColumns = {
  _revision: sql<string>`${documents}.xmin::text`,
  editorLines: sql<EditorLine[]>`coalesce((
    select jsonb_agg(jsonb_build_object(
      'itemId', dl.item_id, 'locationId', dl.location_id, 'unitId', dl.unit_id,
      'quantity', dl.quantity::text, 'unitPrice', dl.unit_price::text,
      'unitCost', dl.unit_cost::text, 'marketPurchase', dl.market_purchase
    ) order by dl.line_no)
    from ${documentLines} dl where dl.document_id = ${documents.id}
  ), '[]'::jsonb)`,
  linkedChequeId: sql<string | null>`(select cr.id from ${chequeRegister} cr where cr.document_id = ${documents.id} order by cr.id limit 1)`,
};
