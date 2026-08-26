import { sql } from "drizzle-orm";

import { db } from "@/lib/db";

// The pre-fix schema stored only a debit/credit row, not the direction chosen
// in the form. It is therefore impossible to safely infer whether an existing
// row should be flipped. This read-only check lists the exact records that need
// business review before any one-time repair is approved.
async function main() {
  const rows = await db.execute<{
    id: string;
    number: string;
    document_date: string;
    contact: string;
    debit: string | null;
    credit: string | null;
    reason: string | null;
    paid_amount: string;
    grand_total: string;
  }>(sql`
    SELECT d.id::text,
           d.number,
           d.document_date::text,
           c.display_name AS contact,
           le.debit::text,
           le.credit::text,
           d.reason,
           d.paid_amount::text,
           d.grand_total::text
    FROM contact_opening_balances cob
    JOIN documents d ON d.id = cob.document_id
    JOIN contacts c ON c.id = cob.contact_id
    LEFT JOIN ledger_entries le ON le.document_id = d.id
    WHERE d.status = 'posted'
    ORDER BY d.document_date, d.number
  `);

  console.log(`opening-balance review: ${rows.length} posted record(s)`);
  for (const row of rows) {
    console.log(JSON.stringify(row));
  }
  console.log("No automatic direction migration is run: legacy rows do not preserve the original form choice.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
