"use client";

import { useEffect, useState, Suspense } from "react";
import dynamic from "next/dynamic";
import { AppShell } from "@/modules/layout/components/AppShell";
import {
  ReportLoadForm,
  loadManualReportFromSession,
} from "@/modules/reports/components/ReportLoadForm";
import type { ManualReportConfig } from "@/types";

const PowerBIReportTile = dynamic(
  () => import("@/modules/tile-engine/components/PowerBIReportTile").then((m) => m.PowerBIReportTile),
  { ssr: false }
);

function DevEmbedContent() {
  const [config, setConfig] = useState<ManualReportConfig | null>(null);

  useEffect(() => {
    setConfig(loadManualReportFromSession());
  }, []);

  return (
    <AppShell>
      <div className="flex h-full flex-col">
        <div className="border-b bg-slate-50 px-4 py-2 text-xs text-slate-600">
          Developer tool — load a report by workspace/report/dataset IDs (Azure Function embed).
        </div>
        <ReportLoadForm onLoad={setConfig} initialConfig={config} />
        <div className="flex-1 overflow-hidden">
          {config ? (
            <PowerBIReportTile
              key={`${config.workspaceId}-${config.reportId}-${config.datasetId}`}
              workspaceId={config.workspaceId}
              reportId={config.reportId}
              datasetId={config.datasetId}
              effectiveIdentity={
                config.rlsUsername && config.rlsRole
                  ? { username: config.rlsUsername, roles: [config.rlsRole] }
                  : undefined
              }
              enablePagination={true}
            />
          ) : (
            <div className="flex h-full items-center justify-center text-slate-500">
              Enter IDs above to test Azure Function embed.
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}

export default function DevEmbedPage() {
  return (
    <Suspense fallback={<div className="p-8 text-slate-500">Loading…</div>}>
      <DevEmbedContent />
    </Suspense>
  );
}
