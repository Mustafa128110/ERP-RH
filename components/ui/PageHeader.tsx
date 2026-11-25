"use client";

import { WorkspaceControls } from "@/components/layout/TableWorkspace";

// The title / record-count / action-buttons strip every list page opens with.
// Stacks below sm and collapses smoothly via TableWorkspace when a list scrolls.
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
      <div className="workspace-collapse-inner">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
          <div className="min-w-0">
            <h1 className="break-words text-lg text-navy-800 sm:text-xl">{title}</h1>
            {subtitle && <p className="text-sm text-steel">{subtitle}</p>}
          </div>
          {children && (
            <WorkspaceControls label={`${title} actions`} mobileRail className="flex flex-wrap items-center gap-2 sm:shrink-0">
              {children}
            </WorkspaceControls>
          )}
        </div>
      </div>
    </div>
  );
}
