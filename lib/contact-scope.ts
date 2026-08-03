// A contact (or any other nullable-scope record — bank accounts, locations)
// with no company is **global**: visible to every company, per the
// company_or_global RLS policy in lib/db/schema.ts.
//
// Every picker that narrows contacts to the company being filed under has to let
// those through, or a global contact can be created and then never picked
// anywhere — which is what happened on the ledger, sale, purchase, payment and
// account-transfer forms, each with its own copy of `c.companyId === companyId`.
//
// The option lists carry "" rather than null for global (the pages map
// `companyId ?? ""` on the way out), so both spellings pass.
export const inCompany =
  (companyId: string) =>
  <T extends { companyId: string | null }>(option: T) =>
    !option.companyId || option.companyId === companyId;
