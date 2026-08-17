import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL, { max: 1 });

const items = await sql`select id, name, company_id from items where name like 'TI-sale-%' order by created_at desc limit 3`;
console.log("test items:", items.map((i) => `${i.name} (${i.id.slice(0, 8)})`).join(", "));

for (const item of items) {
  const docs = await sql`
    select distinct d.id, d.number, d.document_date, d.status, d.reason
    from documents d join document_lines dl on dl.document_id = d.id
    where dl.item_id = ${item.id}
  `;
  console.log(`${item.name}: ${docs.length} document(s)`, docs.map((d) => `#${d.number} (${d.id.slice(0, 8)})`).join(", "));
}

// Any sale documents created today with reason or number around the test?
const recent = await sql`
  select d.id, d.number, d.document_date from documents d
  where d.document_date = current_date
  order by d.created_at desc limit 5
`;
console.log("recent docs today:", recent.map((d) => `${d.number} (${d.id.slice(0, 8)})`).join(", "));

await sql.end();
