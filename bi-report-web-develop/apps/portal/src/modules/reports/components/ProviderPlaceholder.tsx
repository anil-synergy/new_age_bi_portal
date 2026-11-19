"use client";

import { useEffect } from "react";
import { Construction } from "lucide-react";
import { REPORT_REFRESH_DONE_EVENT, REPORT_REFRESH_EVENT } from "@/lib/report-events";
import type { ReportProviderHostProps } from "../providers/types";

export function ProviderPlaceholder({ definition }: ReportProviderHostProps) {
  useEffect(() => {
    const onRefresh = () => window.dispatchEvent(new Event(REPORT_REFRESH_DONE_EVENT));
    window.addEventListener(REPORT_REFRESH_EVENT, onRefresh);
    return () => window.removeEventListener(REPORT_REFRESH_EVENT, onRefresh);
  }, []);

  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="max-w-md rounded-xl border border-slate-200 bg-white p-6 text-center shadow-sm">
        <Construction className="mx-auto h-8 w-8 text-[#1aa6a0]" aria-hidden />
        <h2 className="mt-3 text-base font-semibold text-[#0b2540]">{definition.label}</h2>
        <p className="mt-2 text-sm text-slate-600">{definition.description}</p>
        <p className="mt-3 text-xs text-slate-500">
          This provider is a placeholder. See <code>src/modules/reports/providers/{definition.id}/README.md</code> for
          what is needed to enable it.
        </p>
      </div>
    </div>
  );
}
