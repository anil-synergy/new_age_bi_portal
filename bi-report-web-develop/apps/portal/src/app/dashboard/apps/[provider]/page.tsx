"use client";

import { useEffect, useMemo } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Header } from "@/modules/layout/components/Header";
import { ReportHost } from "@/modules/reports/components/ReportHost";
import { DEFAULT_REPORT_PROVIDER, getReportProvider } from "@/modules/reports/providers/registry";

export default function ProviderAppPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const raw = typeof params.provider === "string" ? params.provider : params.provider?.[0] ?? "";
  const provider = getReportProvider(raw);
  const isPowerBi = provider?.id === DEFAULT_REPORT_PROVIDER;
  const reportId = useMemo(() => {
    const fromQuery = searchParams.get("reportId")?.trim();
    if (fromQuery) return fromQuery;
    return undefined;
  }, [searchParams]);

  // Power BI reports keep their existing /dashboard/:reportId routes.
  useEffect(() => {
    if (isPowerBi) router.replace("/dashboard");
  }, [isPowerBi, router]);

  if (!provider) {
    return <div className="flex h-full items-center justify-center text-slate-500">Unknown report provider.</div>;
  }
  if (isPowerBi) return null;

  return (
    <div className="relative h-full min-h-0">
      <Header title={provider.label} />
      <div className="absolute inset-x-0 bottom-0 top-11 min-h-0">
        <ReportHost providerId={provider.id} reportId={reportId} />
      </div>
    </div>
  );
}
