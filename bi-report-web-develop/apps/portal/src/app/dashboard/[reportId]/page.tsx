"use client";

import { useParams } from "next/navigation";
import { Header } from "@/modules/layout/components/Header";
import { ReportViewer } from "@/modules/reports/components/ReportViewer";
import { usePortal } from "@/context/PortalContext";

export default function ReportPage() {
  const params = useParams();
  const reportId = typeof params.reportId === "string" ? params.reportId : params.reportId?.[0] ?? "";
  const { reports } = usePortal();

  if (!reportId) {
    return (
      <div className="flex h-full items-center justify-center text-slate-500">Invalid report link.</div>
    );
  }

  const report = reports.find((r) => r.id === reportId);

  return (
    <div className="relative h-full min-h-0">
      <Header title={report?.title ?? report?.name ?? "Report"} />
      <div className="absolute inset-x-0 bottom-0 top-11 min-h-0">
        <ReportViewer reportId={reportId} />
      </div>
    </div>
  );
}
