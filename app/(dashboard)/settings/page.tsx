import Link from "next/link";
import { getSettings, settingsOverview } from "@/lib/actions/settings";
import { SETTING_DEFS } from "@/lib/setting-constants";
import { SettingsForm } from "@/components/modules/SettingsForm";
import { StockFilter } from "@/components/modules/StockFilters";
import { SALE_TYPES } from "@/lib/sale-constants";

export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<{ company?: string }> }) {
  const [{ company }, overview] = await Promise.all([searchParams, settingsOverview()]);

  // Settings are per company, so one has to be chosen. Default to the first the
  // user can see, which for a single-company user is the only answer there is.
  const selected = overview.companies.find((c) => c.id === company) ?? overview.companies[0];
  const values = selected ? await getSettings(selected.id) : {};

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl text-navy-800">Settings</h1>
          <p className="text-sm text-steel">Thresholds and text this app actually reads. Stored per company.</p>
        </div>
        <div className="flex items-center gap-2">
          {overview.companies.length > 1 && (
            <StockFilter param="company" allLabel={overview.companies[0]?.name ?? "Company"} options={overview.companies.map((c) => ({ id: c.id, name: c.name }))} />
          )}
          <Link href="/settings/backups" className="flex h-11 items-center rounded border border-sand px-4 text-sm font-medium text-steel hover:bg-ivory">
            Backups &amp; Export →
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="rounded-lg border border-sand bg-white p-5 lg:col-span-2">
          <h2 className="mb-4 text-sm font-semibold text-navy-800">{selected ? `${selected.name} settings` : "Settings"}</h2>
          {selected ? (
            <SettingsForm companyId={selected.id} defs={SETTING_DEFS} values={values} />
          ) : (
            <p className="text-sm text-steel">You don&apos;t have access to any company yet, so there is nothing to configure.</p>
          )}
        </div>

        <div className="flex flex-col gap-6">
          <div className="rounded-lg border border-sand bg-white p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-navy-800">Companies</h2>
              <Link href="/companies" className="text-xs font-medium text-navy-800 hover:underline">
                Manage →
              </Link>
            </div>
            <ul className="flex flex-col divide-y divide-sand">
              {overview.companies.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span className="text-ink">{c.name}</span>
                  <span className="text-xs text-steel">{c.taxNumber ?? "No tax number"}</span>
                </li>
              ))}
              {overview.companies.length === 0 && <li className="py-2 text-sm text-steel">None yet.</li>}
            </ul>
          </div>

          <div className="rounded-lg border border-sand bg-white p-5">
            <h2 className="mb-3 text-sm font-semibold text-navy-800">Connections</h2>
            <ul className="flex flex-col divide-y divide-sand">
              {overview.integrations.map((i) => (
                <li key={i.name} className="flex flex-col gap-1 py-2">
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span className="text-ink">{i.name}</span>
                    <span className={i.connected ? "text-xs font-medium text-success" : "text-xs font-medium text-warning"}>
                      {i.connected ? "Connected" : "Not connected"}
                    </span>
                  </div>
                  <p className="text-xs text-steel">{i.detail}</p>
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-lg border border-sand bg-white p-5">
            <h2 className="mb-3 text-sm font-semibold text-navy-800">Sale channels</h2>
            {/* Read from lib/sale-constants.ts — the list the sale form itself
                offers, rather than a second copy that could disagree with it. */}
            <ul className="flex flex-col divide-y divide-sand">
              {SALE_TYPES.map((t) => (
                <li key={t.value} className="py-2 text-sm text-ink">
                  {t.label}
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-steel">Every sale is filed under one of these. Add one in lib/sale-constants.ts and the schema enum.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
