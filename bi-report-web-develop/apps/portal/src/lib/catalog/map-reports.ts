import type { CategoryPathItem, PortalReport } from "@/types";
import { firstGuid } from "@/lib/azure-embed/ids";

/** Normalize bi-report-api ReportDetailsDto or catalog rows into PortalReport. */
export function mapToPortalReport(raw: Record<string, unknown>): PortalReport {
  // GET /report/reports omits PowerBiReportId / WorkspaceId, so .NET serializes Guid.Empty.
  // Prefer a real GUID over that empty value, then fall back to reportId (which is the PBI id).
  const powerBiReportId = firstGuid(raw.powerBiReportId, raw.powerbi_report_id, raw.reportId);
  const workspaceId = firstGuid(raw.workspaceId, raw.powerWorkSpaceId, raw.powerbi_workspace_id);
  const rlsRoles = raw.powerBiRlsRole as { rlsRole: string; id: string }[] | undefined;

  const applicationType = raw.applicationType ? String(raw.applicationType) : undefined;
  const hostingUrl = raw.hostingUrl ? String(raw.hostingUrl) : raw.hosting_url ? String(raw.hosting_url) : undefined;

  return {
    id: String(raw.id),
    title: String(raw.title ?? raw.name ?? "Report"),
    name: String(raw.name ?? raw.title ?? "Report"),
    description: raw.description ? String(raw.description) : undefined,
    applicationType,
    hostingUrl,
    fabricAppId: raw.fabricAppId ? String(raw.fabricAppId) : raw.app_id ? String(raw.app_id) : undefined,
    powerBiReportId: powerBiReportId ? String(powerBiReportId) : undefined,
    workspaceId: workspaceId ? String(workspaceId) : undefined,
    powerWorkSpaceId: workspaceId ? String(workspaceId) : undefined,
    sourceType: "powerbi",
    rlsEnabled: Boolean(raw.rlsEnabled ?? raw.rls_enabled),
    powerBiRlsRole: rlsRoles,
    enablePagination: Boolean(raw.enablePagination ?? raw.enable_pagination),
    categoryName: raw.categoryName ? String(raw.categoryName) : raw.category_name ? String(raw.category_name) : undefined,
    categoryId: raw.categoryId ? String(raw.categoryId) : raw.category_id ? String(raw.category_id) : undefined,
    categoryPath: mapCategoryPath(raw.categoryPath),
  };
}

function mapCategoryPath(raw: unknown): CategoryPathItem[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const path: CategoryPathItem[] = [];
  for (const item of raw) {
    const node = item as Record<string, unknown> | null;
    if (!node || !node.id || !node.name) return undefined;
    path.push({
      id: String(node.id),
      name: String(node.name),
      parentId: node.parentId ? String(node.parentId) : null,
      displayOrder: typeof node.displayOrder === "number" ? node.displayOrder : 0,
    });
  }
  return path;
}

export function mapReportList(data: unknown): PortalReport[] {
  if (!Array.isArray(data)) return [];
  return data.map((row) => mapToPortalReport(row as Record<string, unknown>));
}
