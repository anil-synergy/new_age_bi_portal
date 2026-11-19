"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { UrlEmbedTile } from "@/modules/tile-engine/components/UrlEmbedTile";
import { getCatalogReportById, getReportPageACL } from "@/services/biServices";
import { usePortal } from "@/context/PortalContext";
import { firstGuid } from "@/lib/azure-embed/ids";
import type { EffectiveIdentity, PageACL, PortalReport } from "@/types";
import { AILoadingAnimation } from "@/modules/loaders/components/AILoadingAnimation";
import { isFabricRayfinCatalogReport } from "@/lib/catalog/fabric-rayfin-detect";

const PowerBIReportTile = dynamic(
  () => import("@/modules/tile-engine/components/PowerBIReportTile").then((m) => m.PowerBIReportTile),
  { ssr: false, loading: () => <AILoadingAnimation stage="fetching-token" /> }
);

const RayfinHost = dynamic(
  () => import("../providers/fabric-rayfin/RayfinHost").then((m) => m.RayfinHost),
  { ssr: false, loading: () => <AILoadingAnimation stage="fetching-token" message="Preparing Fabric app…" /> },
);

interface ReportViewerProps {
  reportId: string;
}

export function ReportViewer({ reportId }: ReportViewerProps) {
  const { isSuperAdmin, userGroupIds, userId, userEmail, reports, isLoading: catalogLoading } = usePortal();
  const catalogReport = useMemo(() => reports.find((r) => r.id === reportId) ?? null, [reports, reportId]);
  const [detailReport, setDetailReport] = useState<PortalReport | null>(null);
  const [detailState, setDetailState] = useState<"idle" | "loading" | "done">("idle");
  const [pageACL, setPageACL] = useState<PageACL[]>([]);

  useEffect(() => {
    let active = true;
    setPageACL([]);
    const isFabric =
      isFabricRayfinCatalogReport(catalogReport) || isFabricRayfinCatalogReport(detailReport);
    if (isFabric) return () => undefined;
    getReportPageACL(reportId)
      .then((acl) => active && setPageACL(acl ?? []))
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [reportId, catalogReport?.applicationType, detailReport?.applicationType]);

  // Always load Postgres-backed row (bi_fabric_apps + bi_report) so Fabric hostingUrl is not lost to stale client cache.
  useEffect(() => {
    let active = true;
    setDetailState("loading");
    getCatalogReportById(reportId)
      .then((detail) => active && setDetailReport(detail))
      .catch(() => active && setDetailReport(null))
      .finally(() => active && setDetailState("done"));
    return () => {
      active = false;
    };
  }, [reportId]);

  const report = useMemo(() => {
    const server = detailReport;
    const client = catalogReport;
    if (detailState === "loading" && !server) {
      if (client && isFabricRayfinCatalogReport(client)) return client;
      return null;
    }
    if (server && isFabricRayfinCatalogReport(server)) return server;
    if (client && isFabricRayfinCatalogReport(client)) return client;
    if (server) return server;
    return client;
  }, [catalogReport, detailReport, detailState]);

  const loading = !report && (detailState !== "done" || catalogLoading);

  const loadError = !report && !loading ? "Report not found or bi-report-api access denied." : null;

  const rlsRolesKey =
    report?.rlsEnabled && !isSuperAdmin && userEmail
      ? (report.powerBiRlsRole ?? []).map((r) => r.rlsRole).filter(Boolean).join("|")
      : "";

  // Keyed on primitives so a background catalog refresh does not re-embed the report.
  const effectiveIdentity: EffectiveIdentity | undefined = useMemo(
    () => (rlsRolesKey ? { username: userEmail, roles: rlsRolesKey.split("|") } : undefined),
    [rlsRolesKey, userEmail]
  );

  if (loading) {
    return <AILoadingAnimation stage="fetching-token" message="Preparing report…" />;
  }

  if (!report) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-slate-500">
        <p>{loadError ?? "Report not found"}</p>
      </div>
    );
  }

  if (report.sourceType === "url" && report.url) {
    return (
      <div className="h-full">
        <UrlEmbedTile url={report.url} title={report.title ?? report.name} />
      </div>
    );
  }

  if (isFabricRayfinCatalogReport(report)) {
    return (
      <div className="h-full min-h-0">
        <RayfinHost
          reportId={report.id}
          definition={{
            id: "fabric-rayfin",
            label: "Fabric Rayfin",
            description: report.description ?? "",
            status: "available",
          }}
        />
      </div>
    );
  }

  const workspaceId = firstGuid(report.workspaceId, report.powerWorkSpaceId) ?? "";
  const powerBiReportId = firstGuid(report.powerBiReportId) ?? "";

  if (!report.id && (!workspaceId || !powerBiReportId)) {
    return <div className="flex h-full items-center justify-center text-slate-500">Invalid report configuration</div>;
  }

  return (
    <PowerBIReportTile
      workspaceId={workspaceId}
      reportId={powerBiReportId}
      catalogId={report.id}
      datasetId={report.datasetId}
      effectiveIdentity={effectiveIdentity}
      isSuperAdmin={isSuperAdmin}
      enablePagination={report.enablePagination}
      pageACL={pageACL}
      userGroupIds={userGroupIds}
      userId={userId}
      title={report.title ?? report.name}
      loaderScene={/qhse/i.test(report.categoryName ?? "") ? "classic" : "portal"}
    />
  );
}
