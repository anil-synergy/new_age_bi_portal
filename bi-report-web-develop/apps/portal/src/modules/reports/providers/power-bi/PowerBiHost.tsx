"use client";

import { ReportViewer } from "@/modules/reports/components/ReportViewer";
import type { ReportProviderHostProps } from "../types";

export function PowerBiHost({ reportId }: ReportProviderHostProps) {
  if (!reportId) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-slate-500">
        Select a report from the menu.
      </div>
    );
  }
  return <ReportViewer reportId={reportId} />;
}
