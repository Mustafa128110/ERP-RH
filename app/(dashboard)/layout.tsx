import { requireSession } from "@/lib/auth/session";
import { getChannels, getSelectedChannel } from "@/lib/queries/channels";
import { ChannelProvider } from "@/components/layout/ChannelProvider";
import { ColumnSizing } from "@/components/layout/ColumnSizing";
import { MobileWorkspaceRail, TableWorkspace, WorkspaceControls } from "@/components/layout/TableWorkspace";
import { Sidebar } from "@/components/layout/Sidebar";
import { Topbar } from "@/components/layout/Topbar";
import { KeyboardShortcuts } from "@/components/layout/KeyboardShortcuts";
import { SessionSeed } from "@/components/layout/SessionSeed";
import { SyncProvider } from "@/components/layout/SyncProvider";
import { PendingWork } from "@/components/layout/PendingWork";
import { OfflineNotice } from "@/components/layout/OfflineNotice";
import { OfflineReadiness } from "@/components/layout/OfflineReadiness";
import { ExportShareProvider } from "@/components/ui/ExportShareSheet";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  const [channels, selected] = await Promise.all([getChannels(), getSelectedChannel()]);
  const permissions = new Set(session.globalPermissions);
  for (const companyPermissions of session.permissionsByCompany.values()) {
    for (const permission of companyPermissions) permissions.add(permission);
  }

  return (
    // Printing (the invoice's Download PDF) takes the page as it stands, so the
    // chrome drops out and the scroll container is released — otherwise the PDF
    // is one screenful of a scrolled div, framed by the sidebar.
    <TableWorkspace>
      {/* Who this browser is, for the user-scoped local persistence. */}
      <SessionSeed userId={session.userId} />
      <ColumnSizing />
      <ChannelProvider channels={channels} selected={selected}>
      <SyncProvider>
        <ExportShareProvider>
          {/* Seeds the client reference cache with the offline workflows' minimum
              data after login — renders nothing. */}
          <OfflineReadiness />
          <KeyboardShortcuts />
          <div className="workspace-sidebar contents print:hidden">
            <Sidebar permissions={[...permissions]} />
          </div>
          <div className="flex min-w-0 flex-1 flex-col overflow-hidden print:block print:overflow-visible">
            <div className="print:hidden">
              <Topbar username={session.name} channels={channels} selected={selected} />
            </div>
            {/* Sits above the scroll container, not inside it, so the sentence stays
                put while a long list scrolls under it. Renders nothing when online. */}
            <WorkspaceControls label="Connection"><OfflineNotice /></WorkspaceControls>
            {/* Gutters are deliberately tight: a 24px frame consumes a sixth of a
                360px screen. The bottom inset clears the iOS home indicator. */}
            <div className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden print:block print:overflow-visible">
              <main data-workspace-main className="min-w-0 flex-1 overflow-x-hidden overflow-y-auto bg-ivory p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:p-3 lg:p-4 print:overflow-visible print:bg-white print:p-0">
                <WorkspaceControls label="Pending work"><PendingWork /></WorkspaceControls>
                {children}
              </main>
              <MobileWorkspaceRail />
            </div>
          </div>
        </ExportShareProvider>
      </SyncProvider>
      </ChannelProvider>
    </TableWorkspace>
  );
}
