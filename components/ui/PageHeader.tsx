"use client";

import {WorkspaceControls} from "@/components/layout/TableWorkspace";

// The title / record-count / action-buttons strip every list page opens with.
// Stacks below sm. A title plus four action buttons on one line is what pushes a
// 360px screen into horizontal scrolling, and the actions are what get cut off —
// so they drop under the title and wrap among themselves instead.
export function PageHeader({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children?: React.ReactNode;
}) {
  return (
    <div data-page-header className="shrink-0">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div className="min-w-0">
          <h1 className="break-words text-lg text-navy-800 sm:text-xl">{title}</h1>
          {subtitle && <p className="text-sm text-steel">{subtitle}</p>}
        </div>
        {children && <WorkspaceControls label={`${title} actions`} className="flex flex-wrap items-center gap-2 sm:shrink-0">{children}</WorkspaceControls>}
      </div>
    </div>
  );
}
