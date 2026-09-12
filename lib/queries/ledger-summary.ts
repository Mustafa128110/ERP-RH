import "server-only";
import {and,desc,eq,inArray,isNotNull,lte,sql,type SQL} from "drizzle-orm";
import {db} from "@/lib/db";
import {ledgerEntries,documents,documentTypes,contacts,companies,bankAccounts,cashAccounts,chequeRegister} from "@/lib/db/schema";

// Aggregate before crossing the database connection. Settlement ownership is
// the same rule used by the statement and FIFO allocation engine.
export function ledgerSummaryRows(scope: SQL | undefined) {
  return db.select({
    contactId:contacts.id,_revision:sql<string>`${contacts}.xmin::text`,displayName:contacts.displayName,
    companyId:ledgerEntries.companyId,company:sql<string>`coalesce(${companies.shortName},${companies.name})`,
    credit:sql<string>`sum(${ledgerEntries.credit})::text`,debit:sql<string>`sum(${ledgerEntries.debit})::text`,
  }).from(ledgerEntries)
    .innerJoin(documents,eq(documents.id,ledgerEntries.documentId))
    .innerJoin(documentTypes,eq(documentTypes.id,documents.documentTypeId))
    .innerJoin(companies,eq(companies.id,ledgerEntries.companyId))
    .leftJoin(contacts,eq(contacts.id,documents.contactId))
    .leftJoin(bankAccounts,eq(bankAccounts.id,documents.bankAccountId))
    .leftJoin(cashAccounts,eq(cashAccounts.id,documents.cashAccountId))
    .leftJoin(chequeRegister,eq(chequeRegister.documentId,documents.id))
    .where(and(scope,sql`CASE WHEN ${documentTypes.code} NOT IN ('PAYMENT_MADE','PAYMENT_RECEIVED') THEN true
      WHEN ${documents.bankAccountId} IS NOT NULL THEN ${bankAccounts.companyId} IS NULL OR ${bankAccounts.companyId}=${ledgerEntries.companyId}
      WHEN ${documents.cashAccountId} IS NOT NULL THEN ${cashAccounts.companyId}=${ledgerEntries.companyId}
      ELSE ${chequeRegister.companyId}=${ledgerEntries.companyId} END`))
    .groupBy(contacts.id,sql`${contacts}.xmin::text`,contacts.displayName,ledgerEntries.companyId,companies.shortName,companies.name);
}

// Six per company, contact and document kind, not six across the whole list.
// Filtering happens before ranking so malformed historical settlements cannot
// displace a valid payment from the visible recent history.
export function recentLedgerDocuments(scope: SQL | undefined, codes: readonly (typeof documentTypes.$inferSelect.code)[], payment = false) {
  const ranked=db.select({
    id:documents.id,companyId:documents.companyId,contactId:documents.contactId,
    number:documents.number,status:documents.status,grandTotal:documents.grandTotal,
    paidAmount:documents.paidAmount,isPaid:documents.isPaid,documentDate:documents.documentDate,
    createdAt:documents.createdAt,code:documentTypes.code,
    position:sql<number>`row_number() over(partition by ${documents.companyId},${documents.contactId},${documentTypes.code} order by ${documents.documentDate} desc,${documents.createdAt} desc,${documents.id})`.as('position'),
  }).from(documents)
    .innerJoin(documentTypes,eq(documentTypes.id,documents.documentTypeId))
    .leftJoin(bankAccounts,eq(bankAccounts.id,documents.bankAccountId))
    .leftJoin(cashAccounts,eq(cashAccounts.id,documents.cashAccountId))
    .where(and(scope,inArray(documentTypes.code,codes),eq(documents.status,'posted'),isNotNull(documents.contactId),
      payment?sql`CASE WHEN ${documents.bankAccountId} IS NOT NULL THEN ${bankAccounts.companyId} IS NULL OR ${bankAccounts.companyId}=${documents.companyId}
        WHEN ${documents.cashAccountId} IS NOT NULL THEN ${cashAccounts.companyId}=${documents.companyId} ELSE true END`:undefined))
    .as('recent_ledger_documents');
  return db.select().from(ranked).where(lte(ranked.position,6)).orderBy(desc(ranked.documentDate),desc(ranked.createdAt),ranked.id);
}
