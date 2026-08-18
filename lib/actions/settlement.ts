import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

// Not "use server". This module's one export takes a live transaction handle,
// which can't cross an HTTP boundary — the directive published it as an endpoint
// anyway. The option lists that used to sit alongside it moved to
// lib/queries/lookups.ts.

export type SettlementType = "account" | "cash" | "cheque";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export class SettlementScopeError extends Error {
  constructor() {
    super("That settlement account does not belong to this company.");
    this.name = "SettlementScopeError";
  }
}

export interface SettlementMovement {
  direction: "in" | "out";
  amount: string;
  bankAccountId: string | null;
  cashAccountId: string | null;
  chequeId: string | null;
  sign: 1 | -1;
  companyId: string;
}

// Validate and apply an arbitrary number of settlement movements in one
// statement. The VALUES table preserves the same bank -> cash -> cheque
// precedence as the single-row helper, while the grouped UPDATEs ensure that a
// twenty-row batch touching three drawers takes one database round trip rather
// than twenty (or even three). Both updates and the validation live in the same
// statement, so a forged cross-company target changes nothing before the
// transaction is rejected.
export async function adjustSettlementBalancesBatch(tx: Tx, movements: SettlementMovement[]) {
  if (movements.length === 0) return;

  const values = sql.join(
    movements.map((movement) => {
      const kind = movement.bankAccountId ? "bank" : movement.cashAccountId ? "cash" : movement.chequeId ? "cheque" : "missing";
      const targetId = movement.bankAccountId ?? movement.cashAccountId ?? movement.chequeId;
      const delta = String((movement.direction === "out" ? -1 : 1) * movement.sign * Number(movement.amount));
      return sql`(${kind}::text, ${targetId}::uuid, ${movement.companyId}::uuid, ${delta}::numeric)`;
    }),
    sql`, `,
  );

  const [result] = await tx.execute<{ invalid_count: number }>(sql`
    WITH input(kind, target_id, company_id, delta) AS (
      VALUES ${values}
    ),
    checked AS (
      SELECT i.*,
        CASE
          WHEN i.kind = 'bank' THEN EXISTS (
            SELECT 1 FROM bank_accounts b
            WHERE b.id = i.target_id AND (b.company_id IS NULL OR b.company_id = i.company_id)
          )
          WHEN i.kind = 'cash' THEN EXISTS (
            SELECT 1 FROM cash_accounts c
            WHERE c.id = i.target_id AND c.company_id = i.company_id
          )
          WHEN i.kind = 'cheque' THEN EXISTS (
            SELECT 1 FROM cheque_register q
            WHERE q.id = i.target_id AND q.company_id = i.company_id
          )
          ELSE false
        END AS valid
      FROM input i
    ),
    bank_moves AS (
      SELECT account_id, sum(delta) AS delta
      FROM (
        SELECT target_id AS account_id, delta
        FROM checked
        WHERE valid AND kind = 'bank'
        UNION ALL
        SELECT q.bank_account_id AS account_id, c.delta
        FROM checked c
        JOIN cheque_register q
          ON c.kind = 'cheque'
         AND c.valid
         AND q.id = c.target_id
         AND q.company_id = c.company_id
         AND q.issued_by_company = true
        WHERE q.bank_account_id IS NOT NULL
      ) movements
      GROUP BY account_id
    ),
    cash_moves AS (
      SELECT target_id AS account_id, sum(delta) AS delta
      FROM checked
      WHERE valid AND kind = 'cash'
      GROUP BY target_id
    ),
    updated_banks AS (
      UPDATE bank_accounts b
      SET current_balance = b.current_balance + m.delta
      FROM bank_moves m
      WHERE b.id = m.account_id
      RETURNING b.id
    ),
    updated_cash AS (
      UPDATE cash_accounts c
      SET current_balance = c.current_balance + m.delta
      FROM cash_moves m
      WHERE c.id = m.account_id
      RETURNING c.id
    )
    SELECT count(*) FILTER (WHERE NOT valid)::int AS invalid_count,
           (SELECT count(*) FROM updated_banks) AS updated_banks,
           (SELECT count(*) FROM updated_cash) AS updated_cash
    FROM checked
  `);

  if (!result || Number(result.invalid_count) > 0) throw new SettlementScopeError();
}

// direction "out": money leaves the company (debit the account) — expenses,
// paid purchases, payments made. direction "in": money enters — payments
// received. Cheques settle indirectly through the bank account they're
// drawn on/deposited to.
export async function adjustSettlementBalance(
  tx: Tx,
  direction: "in" | "out",
  amount: string,
  bankAccountId: string | null,
  cashAccountId: string | null,
  chequeId: string | null,
  sign: 1 | -1,
  companyId: string,
) {
  await adjustSettlementBalancesBatch(tx, [{ direction, amount, bankAccountId, cashAccountId, chequeId, sign, companyId }]);
}
