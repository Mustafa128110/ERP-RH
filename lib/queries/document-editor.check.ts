import assert from "node:assert/strict";
import { eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { documents, documentLines, documentTypes, chequeRegister } from "@/lib/db/schema";
import { documentEditorColumns } from "./document-editor";

// Read-only equivalence against the old editor reads, within one snapshot.
async function main() {
  await db.transaction(async tx => {
    const rows = await tx.select({ id: documents.id, ...documentEditorColumns })
      .from(documents).innerJoin(documentTypes, eq(documents.documentTypeId, documentTypes.id))
      .where(inArray(documentTypes.code, ["SALES_INVOICE", "PURCHASE_INVOICE"]));
    assert.ok(rows.length > 0, "No sale/purchase editor records to verify");
    const ids = rows.map(row => row.id);
    const lines = await tx.select({ documentId: documentLines.documentId, itemId: documentLines.itemId,
      locationId: documentLines.locationId, unitId: documentLines.unitId, quantity: documentLines.quantity,
      unitPrice: documentLines.unitPrice, unitCost: documentLines.unitCost, marketPurchase: documentLines.marketPurchase,
    }).from(documentLines).where(inArray(documentLines.documentId, ids)).orderBy(documentLines.lineNo);
    const cheques = await tx.select({ id: chequeRegister.id, documentId: chequeRegister.documentId })
      .from(chequeRegister).where(inArray(chequeRegister.documentId, ids)).orderBy(chequeRegister.id);
    const versions = await tx.select({ id: documents.id, version: sql<string>`${documents}.xmin::text` }).from(documents).where(inArray(documents.id, ids));
    for (const row of rows) {
      assert.deepEqual(row.editorLines, lines.filter(line => line.documentId === row.id).map(({ itemId, locationId, unitId, quantity, unitPrice, unitCost, marketPurchase }) => ({ itemId, locationId, unitId, quantity, unitPrice, unitCost, marketPurchase })));
      assert.equal(row.linkedChequeId, cheques.find(cheque => cheque.documentId === row.id)?.id ?? null);
      assert.equal(row._revision, versions.find(version => version.id === row.id)?.version);
    }
    console.log(`Document editor snapshot equivalence passed for ${rows.length} records (read only)`);
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}
main().finally(() => db.$client.end());
