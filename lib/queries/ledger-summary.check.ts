import assert from 'node:assert/strict';
import {inArray,sql} from 'drizzle-orm';
import {db} from '@/lib/db';
import {companies,documents,ledgerEntries} from '@/lib/db/schema';
import {withReadSnapshot} from '@/lib/db/read-snapshot';
import {ledgerSummaryRows,recentLedgerDocuments} from './ledger-summary';
async function main(){
 const ids=(await db.select({id:companies.id}).from(companies)).map(row=>row.id);
 for(const scopeIds of [[],...ids.map(id=>[id]),ids])await withReadSnapshot(async()=>{
  const ledgerScope=scopeIds.length?inArray(ledgerEntries.companyId,scopeIds):sql`false`;
  const documentScope=scopeIds.length?inArray(documents.companyId,scopeIds):sql`false`;
  // Reference behavior: fetch the source rows, filter using the previous JS
  // ownership rule, and sum in JS. This intentionally remains unbounded here.
  const source=await db.execute<{contactId:string|null;companyId:string;credit:string;debit:string;code:string;bank:string|null;cash:string|null;bankCompany:string|null;cashCompany:string|null;chequeCompany:string|null}>(sql`
    SELECT contacts.id AS "contactId",ledger_entries.company_id AS "companyId",credit,debit,document_types.code,
      documents.bank_account_id AS bank,documents.cash_account_id AS cash,bank_accounts.company_id AS "bankCompany",cash_accounts.company_id AS "cashCompany",cheque_register.company_id AS "chequeCompany"
    FROM ledger_entries JOIN documents ON documents.id=ledger_entries.document_id JOIN document_types ON document_types.id=documents.document_type_id
    LEFT JOIN contacts ON contacts.id=documents.contact_id LEFT JOIN bank_accounts ON bank_accounts.id=documents.bank_account_id
    LEFT JOIN cash_accounts ON cash_accounts.id=documents.cash_account_id LEFT JOIN cheque_register ON cheque_register.document_id=documents.id WHERE ${ledgerScope}`);
  const expected=new Map<string,{credit:number;debit:number}>();
  for(const row of source){
   if(['PAYMENT_MADE','PAYMENT_RECEIVED'].includes(row.code)){
    const valid=row.bank?row.bankCompany===null||row.bankCompany===row.companyId:row.cash?row.cashCompany===row.companyId:row.chequeCompany===row.companyId;
    if(!valid)continue;
   }
   const key=`${row.companyId}:${row.contactId}`,value=expected.get(key)??{credit:0,debit:0};
   value.credit+=Number(row.credit);value.debit+=Number(row.debit);expected.set(key,value);
  }
  const actual=await ledgerSummaryRows(ledgerScope);
  assert.equal(actual.length,expected.size);
  for(const row of actual){const prior=expected.get(`${row.companyId}:${row.contactId}`)!;assert.ok(prior);assert.ok(Math.abs(Number(row.credit)-prior.credit)<0.0001);assert.ok(Math.abs(Number(row.debit)-prior.debit)<0.0001)}
  for(const codes of [['PAYMENT_MADE','PAYMENT_RECEIVED'],['SALES_INVOICE'],['PURCHASE_INVOICE']] as const){
   const payment=codes[0].startsWith('PAYMENT');
   const all=await db.execute<{id:string;companyId:string;contactId:string;code:string;bank:string|null;cash:string|null;bankCompany:string|null;cashCompany:string|null}>(sql`
    SELECT documents.id,documents.company_id AS "companyId",documents.contact_id AS "contactId",document_types.code,
      documents.bank_account_id AS bank,documents.cash_account_id AS cash,bank_accounts.company_id AS "bankCompany",cash_accounts.company_id AS "cashCompany"
    FROM documents JOIN document_types ON document_types.id=documents.document_type_id LEFT JOIN bank_accounts ON bank_accounts.id=documents.bank_account_id
    LEFT JOIN cash_accounts ON cash_accounts.id=documents.cash_account_id WHERE ${documentScope} AND documents.status='posted' AND documents.contact_id IS NOT NULL
      AND document_types.code IN (${sql.join(codes.map(code=>sql`${code}`),sql`,`)}) ORDER BY documents.document_date DESC,documents.created_at DESC,documents.id`);
   const counts=new Map<string,number>();const wanted=[];
   for(const row of all){
    if(payment && (row.bank?row.bankCompany!==null&&row.bankCompany!==row.companyId:row.cash?row.cashCompany!==row.companyId:false))continue;
    const key=`${row.companyId}:${row.contactId}:${row.code}`,count=counts.get(key)??0;counts.set(key,count+1);if(count<6)wanted.push(row.id);
   }
   const recent=await recentLedgerDocuments(documentScope,codes,payment);
   assert.deepEqual(recent.map(row=>row.id),wanted,'the newest six valid records per company, contact and direction remain unchanged');
   assert.ok(recent.every(row=>row.position<=6));
  }
 });
 console.log('Ledger summary checks passed: exact balances and six recent valid records per company/contact/kind for empty, individual and combined scopes');
}
main().finally(()=>db.$client.end()).catch(error=>{console.error(error);process.exitCode=1});
