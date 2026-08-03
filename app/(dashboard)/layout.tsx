import { requireSession } from "@/lib/auth/session";
import { getSelectedScope } from "@/lib/auth/scope";
import { getAccessibleCompanies } from "@/lib/actions/scope";
import { Sidebar } from "@/components/layout/Sidebar";
import { Topbar } from "@/components/layout/Topbar";
import { KeyboardShortcuts } from "@/components/layout/KeyboardShortcuts";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  const [companies, selected] = await Promise.all([getAccessibleCompanies(), getSelectedScope()]);

  return (
    // Printing (the invoice's Download PDF) takes the page as it stands, so the
    // chrome drops out and the scroll container is released — otherwise the PDF
    // is one screenful of a scrolled div, framed by the sidebar.
    <div className="flex h-screen overflow-hidden print:block print:h-auto print:overflow-visible">
      <KeyboardShortcuts />
      <div className="contents print:hidden">
        <Sidebar />
      </div>
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden print:block print:overflow-visible">
        <div className="print:hidden">
          <Topbar username={session.name} companies={companies} selected={selected} />
        </div>
        {/* Tighter gutters on a phone — 24px each side of a 360px screen is a
            sixth of it. pb picks up the home-indicator inset on iOS, which
            otherwise sits over the last row of a list. */}
        <main className="flex-1 overflow-x-hidden overflow-y-auto bg-ivory p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:p-4 lg:p-6 print:overflow-visible print:bg-white print:p-0">
          {children}
        </main>
      </div>
    </div>
  );
}
