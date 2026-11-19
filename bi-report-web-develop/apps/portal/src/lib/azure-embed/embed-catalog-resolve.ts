import type { PortalReport } from "@/types";
import { embedRolesForReport } from "./embed-rls";

export type EmbedCatalogMatch = {
  catalogId?: string;
  workspaceId?: string;
  powerBiReportId?: string;
};

function normGuid(value: string | undefined): string | undefined {
  const v = value?.trim();
  return v ? v.toLowerCase() : undefined;
}

/** Match a catalog row by portal id or Power BI workspace + report (case-insensitive). */
export function findPortalReportInCatalog(reports: PortalReport[], match: EmbedCatalogMatch): PortalReport | undefined {
  const catalogId = normGuid(match.catalogId);
  if (catalogId) {
    const byId = reports.find((r) => r.id.toLowerCase() === catalogId);
    if (byId) return byId;
  }

  const workspaceId = normGuid(match.workspaceId);
  const powerBiReportId = normGuid(match.powerBiReportId);
  if (!workspaceId || !powerBiReportId) return undefined;

  return reports.find((r) => {
    const ws = normGuid(r.workspaceId) ?? normGuid(r.powerWorkSpaceId);
    const reportId = normGuid(r.powerBiReportId);
    return ws === workspaceId && reportId === powerBiReportId;
  });
}

/** Catalog/DB mapping only — never trust browser-supplied roles for token mint. */
export function resolveEmbedRoles(
  report: PortalReport | undefined,
  isSuperAdmin: boolean,
): string[] {
  if (!report?.rlsEnabled) return [];
  return embedRolesForReport(report, isSuperAdmin);
}
