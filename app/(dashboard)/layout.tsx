import { requireSession } from "@/lib/auth/session";
import { getSelectedScope } from "@/lib/auth/scope";
import { getAccessibleCompanies } from "@/lib/actions/scope";
import { Sidebar } from "@/components/layout/Sidebar";
import { Topbar } from "@/components/layout/Topbar";
import { KeyboardShortcuts } from "@/components/layout/KeyboardShortcuts";
import { SessionSeed } from "@/components/layout/SessionSeed";
import { SyncProvider } from "@/components/layout/SyncProvider";
import { OfflineReadiness } from "@/components/layout/OfflineReadiness";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  const [companies, selected] = await Promise.all([getAccessibleCompanies(), getSelectedScope()]);
  const permissions = new Set(session.globalPermissions);
  for (const companyPermissions of session.permissionsByCompany.values()) {
    for (const permission of companyPermissions) permissions.add(permission);
  }

  return (
    // Printing (the invoice's Download PDF) takes the page as it stands, so the
    // chrome drops out and the scroll container is released — otherwise the PDF
    // is one screenful of a scrolled div, framed by the sidebar.
    <div className="flex h-screen overflow-hidden print:block print:h-auto print:overflow-visible">
      {/* Who this browser is, for the user-scoped local persistence. */}
      <SessionSeed userId={session.userId} />
      <SyncProvider>
      {/* Seeds the client reference cache with the offline workflows' minimum
          data after login — renders nothing. */}
      <OfflineReadiness />
      <KeyboardShortcuts />
      <div className="contents print:hidden">
        <Sidebar permissions={[...permissions]} />
      </div>
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden print:block print:overflow-visible">
        <div className="print:hidden">
          <Topbar username={session.name} companies={companies} selected={selected} />
        </div>
        {/* Tighter gutters on a phone — 24px each side of a 360px screen is a
            sixth of it. pb picks up the home-indicator inset on iOS, which
            otherwise sits over the last row of a list. */}
        {/* Gutters tightened from p-3/4/6: the list underneath is the reason
            the screen exists, and a 24px frame on a 1080p monitor was costing
            it two rows. pb picks up the home-indicator inset on iOS, which
            otherwise sits over the last row of a list. */}
        <main className="flex-1 overflow-x-hidden overflow-y-auto bg-ivory p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:p-3 lg:p-4 print:overflow-visible print:bg-white print:p-0">
          {children}
        </main>
      </div>
      </SyncProvider>
    </div>
  );
}
