import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL, { max: 1 });

const q = async (label, fn) => {
  try {
    const rows = await fn();
    console.log(`${label}:`, rows.map((r) => r.name ?? r).join(", "));
  } catch (e) {
    console.log(`${label}: ERROR ${e.message?.slice(0, 80)}`);
  }
};

await q("locations", () => sql`select name from locations order by name`);
await q("units", () => sql`select name from units order by name limit 5`);
await q("companies", () => sql`select name from companies order by name`);
await q("default cash", () => sql`select name from cash_accounts where is_default`);
await q("bank accounts", () => sql`select name from bank_accounts order by name limit 5`);
await q("contacts", () => sql`select name from contacts where name ilike '%supplier%' or name ilike '%counter%' order by name limit 6`);
await q("RH items", () => sql`select name from items where company_id = (select id from companies where name = 'Royal Hardware') order by name limit 5`);
await q("cash-transfer docs today", () => sql`select count(*)::int as n from documents where reason like 'Cash Transfer %' and document_date = current_date`);

await sql.end();
