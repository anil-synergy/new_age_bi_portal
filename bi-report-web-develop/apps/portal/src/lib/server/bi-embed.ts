import { NextRequest, NextResponse } from "next/server";
import type { PortalReport } from "@/types";
import { emailFromBearer } from "@/lib/catalog/entra-user";
import { loadCatalogForEmail } from "@/lib/catalog/reports-catalog";
import { getDevDbPool } from "@/lib/catalog/dev-db";
import { firstGuid } from "@/lib/azure-embed/ids";
import {
  acquirePowerBiServiceToken,
  powerBiApiRequest,
  resolvePowerBiDatasetId,
  servicePrincipalConfigured,
} from "@/lib/azure-embed/generate-embed-token";
import { embedPathsConfigured, requestPortalEmbedToken } from "@/lib/azure-embed/embed-token-issue";
import { buildRlsIdentities, needsEffectiveIdentity, RlsRolesRequiredError } from "@/lib/azure-embed/embed-rls";
import { resolveEmbedRoles } from "@/lib/azure-embed/embed-catalog-resolve";
import {
  EmbedMissingRlsConfigError,
  resolveEmbedPayloadPolicy,
} from "@/lib/azure-embed/embed-payload-policy";
import { resolveDatasetForEmbed } from "@/lib/catalog/dataset-from-catalog";
import { resolveEmbedRlsContext } from "@/lib/catalog/rls-access";

const SIGN_IN_REQUIRED = { message: "Sign in required" } as const;
const UNAUTHORIZED = { message: "Unauthorized" } as const;
const ACCESS_DENIED = { message: "Access denied" } as const;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const EXPORT_POLL_MS = 5_000;
const EXPORT_TIMEOUT_MS = 10 * 60 * 1000;

type AuthOk = { email: string; userId: string; report: PortalReport; isSuperAdmin: boolean };

export function isBiEmbedPath(method: string, path: string[]): boolean {
  if (method !== "GET") return false;
  if (path.length !== 6) return false;
  if (path[0] !== "bi-report-api" || path[1] !== "v1") return false;
  return path[2] === "report" && path[3] === "token" && path[5] === "embededd" && UUID_RE.test(path[4]);
}

export function isBiDownloadPath(method: string, path: string[]): boolean {
  if (method !== "POST") return false;
  if (path.length !== 7) return false;
  if (path[0] !== "bi-report-api" || path[1] !== "v1") return false;
  return (
    path[2] === "report" &&
    path[3] === "token" &&
    path[4] === "report" &&
    path[6] === "download" &&
    UUID_RE.test(path[5])
  );
}

async function authenticateForCatalogReport(
  authorization: string | null,
  catalogReportId: string,
): Promise<AuthOk | NextResponse> {
  let email: string | null;
  try {
    email = await emailFromBearer(authorization);
  } catch {
    return NextResponse.json(SIGN_IN_REQUIRED, { status: 401 });
  }
  if (!email || !authorization) {
    return NextResponse.json(SIGN_IN_REQUIRED, { status: 401 });
  }

  const catalog = await loadCatalogForEmail(email);
  if (!catalog.userFound || !catalog.userInfo.id) {
    return NextResponse.json(UNAUTHORIZED, { status: 401 });
  }

  const report = catalog.reports.find((r) => r.id.toLowerCase() === catalogReportId.toLowerCase());
  if (!report) {
    return NextResponse.json(ACCESS_DENIED, { status: 403 });
  }

  return {
    email,
    userId: catalog.userInfo.id,
    report,
    isSuperAdmin: catalog.isSuperAdmin,
  };
}

function rolesForEmbed(report: PortalReport, isSuperAdmin: boolean): string[] {
  return resolveEmbedRoles(report, isSuperAdmin);
}

export async function issueEmbedTokenForReport(
  report: PortalReport,
  email: string,
  isSuperAdmin: boolean,
  catalogReportId: string,
  userId: string,
): Promise<Record<string, unknown> | NextResponse> {
  if (!embedPathsConfigured()) {
    return NextResponse.json({ message: "Power BI embed is not configured on the portal." }, { status: 502 });
  }

  const workspaceId = firstGuid(report.workspaceId, report.powerWorkSpaceId);
  const powerBiReportId = firstGuid(report.powerBiReportId);
  if (!workspaceId || !powerBiReportId) {
    return NextResponse.json({ message: "Report is missing Power BI workspace or report id." }, { status: 502 });
  }

  const rlsCtx = await resolveEmbedRlsContext(userId, { catalogReportId });
  const roles = rlsCtx?.roles ?? rolesForEmbed(report, isSuperAdmin);
  const superAdmin = rlsCtx?.isSuperAdmin ?? isSuperAdmin;
  const rlsEnabled = rlsCtx?.rlsEnabled ?? report.rlsEnabled ?? false;
  const rlsBypassed = rlsCtx?.rlsBypassed ?? report.rlsBypassed ?? false;
  const lookup = resolveDatasetForEmbed({
    workspaceId,
    powerBiReportId: powerBiReportId,
    portalCatalogId: catalogReportId,
    titles: [report.title, report.name].filter(Boolean) as string[],
  });
  // Portal DB semantic model first (bi_report.semanticmodel_id); metadata file only as fallback.
  const datasetId = firstGuid(rlsCtx?.semanticModelId, report.semanticModelId, lookup.datasetId);
  if (!datasetId) {
    return NextResponse.json(
      { message: "Dataset ID is missing for this report in the portal catalog." },
      { status: 400 },
    );
  }
  let payload;
  try {
    payload = resolveEmbedPayloadPolicy({
      signedInEmail: email,
      roles,
      datasetId,
      isSuperAdmin: superAdmin,
      rlsEnabled,
      rlsBypassed,
    });
  } catch (error) {
    if (error instanceof EmbedMissingRlsConfigError) {
      return NextResponse.json({ message: error.message }, { status: 400 });
    }
    throw error;
  }
  let issued;
  try {
    issued = await requestPortalEmbedToken({
      workspaceId,
      reportId: powerBiReportId,
      datasetId,
      username: payload.username,
      roles: payload.roles,
      effectiveIdentity: payload.effectiveIdentity,
      skipIdentity: payload.skipIdentity,
      applyDatasourceIdentity: payload.applyDatasourceIdentity,
      rlsRolesForIdentityRetry: roles.length > 0 ? roles : undefined,
      embedType: "report",
    });
  } catch (error) {
    if (error instanceof RlsRolesRequiredError) {
      return NextResponse.json({ message: error.message }, { status: 403 });
    }
    throw error;
  }

  return {
    reportId: catalogReportId,
    groupId: workspaceId,
    workspaceId,
    token: issued.accessToken,
    embeddedUrl: issued.embedUrl,
    enablePagination: report.enablePagination ?? false,
    reportName: report.title ?? report.name ?? "",
  };
}

/** Best-effort access log; failures are swallowed. */
export async function recordReportAccess(userId: string, reportId: string): Promise<void> {
  try {
    const db = getDevDbPool();
    const existing = await db.query<{ id: string; accessed_at: unknown }>(
      `SELECT id::text, accessed_at FROM report_access_log WHERE user_id = $1 AND report_id = $2 LIMIT 1`,
      [userId, reportId],
    );
    const stamp = new Date().toISOString();
    if (!existing.rows[0]) {
      await db.query(
        `INSERT INTO report_access_log (id, user_id, report_id, accessed_at)
         VALUES (gen_random_uuid(), $1, $2, $3::jsonb)`,
        [userId, reportId, JSON.stringify([stamp])],
      );
      return;
    }
    const prior = existing.rows[0].accessed_at;
    const list = Array.isArray(prior) ? [...prior, stamp] : [stamp];
    await db.query(`UPDATE report_access_log SET accessed_at = $2::jsonb WHERE id = $1`, [
      existing.rows[0].id,
      JSON.stringify(list),
    ]);
  } catch {
    // Non-fatal
  }
}

function normalizeExportFormat(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") {
    const byIndex = ["PDF", "XLSX", "PPTX", "DOCX", "CSV", "XML", "MHTML", "PNG", "IMAGE"];
    return byIndex[value] ?? null;
  }
  const s = String(value).trim().toUpperCase();
  if (s === "PPT") return "PPTX";
  return s || null;
}

interface FilterItem {
  tableName?: string;
  column?: string;
  selectedValue?: string;
}

function buildExportFilter(filters: FilterItem[] | undefined): string | undefined {
  if (!filters?.length) return undefined;
  const grouped = new Map<string, string[]>();
  for (const f of filters) {
    if (!f.tableName || !f.column || f.selectedValue === undefined) continue;
    const key = `${f.tableName}/${f.column}`;
    const list = grouped.get(key) ?? [];
    list.push(f.selectedValue);
    grouped.set(key, list);
  }
  const parts: string[] = [];
  for (const [key, values] of grouped) {
    if (values.length > 1) {
      parts.push(`${key} in(${values.map((v) => `'${v.replace(/'/g, "''")}'`).join(",")})`);
    } else {
      parts.push(`${key} eq '${values[0]!.replace(/'/g, "''")}'`);
    }
  }
  return parts.length ? parts.join(" and ") : undefined;
}

async function exportReportFile(
  report: PortalReport,
  email: string,
  isSuperAdmin: boolean,
  body: Record<string, unknown>,
): Promise<{ bytes: ArrayBuffer; contentType: string; fileName: string }> {
  const workspaceId = firstGuid(report.workspaceId, report.powerWorkSpaceId);
  const powerBiReportId = firstGuid(report.powerBiReportId);
  if (!workspaceId || !powerBiReportId) {
    throw new Error("Report is missing Power BI ids.");
  }

  const format = normalizeExportFormat(body.exportFileFormat ?? body.ExportFileFormat);
  if (!format) {
    throw new Error("exportFileFormat is required");
  }

  const roles = rolesForEmbed(report, isSuperAdmin);
  const datasetId = await resolvePowerBiDatasetId(workspaceId, powerBiReportId, report.datasetId);

  const config: Record<string, unknown> = {};
  const filterExpr = buildExportFilter(body.filters as FilterItem[] | undefined);
  if (filterExpr) config.reportLevelFilters = [{ filter: filterExpr }];

  if (body.onlyCurrentPage || body.OnlyCurrentPage) {
    const pages = (body.pageParameters ?? body.PageParameters) as Array<{ pageName?: string }> | undefined;
    if (pages?.length) config.pages = pages.map((p) => ({ pageName: p.pageName })).filter((p) => p.pageName);
  }

  const attachIdentity = (withRls: boolean) => {
    if (!withRls || !datasetId || !roles.length) return;
    const identities = buildRlsIdentities(email, roles, datasetId);
    if (identities) config.identities = identities;
  };

  attachIdentity(false);

  const startExport = async () =>
    powerBiApiRequest(`/groups/${workspaceId}/reports/${powerBiReportId}/ExportToFile`, {
      method: "POST",
      body: JSON.stringify({ format, powerBIReportConfiguration: config }),
    });

  let start = await startExport();
  if (!start.ok && start.status === 400 && needsEffectiveIdentity(start.text)) {
    if (!roles.length) {
      throw new RlsRolesRequiredError();
    }
    if (!datasetId) {
      throw new Error("Could not resolve the Power BI dataset id for this report.");
    }
    attachIdentity(true);
    start = await startExport();
  }

  if (!start.ok) {
    throw new Error(start.text.slice(0, 300) || "Export failed to start.");
  }
  const exportId = typeof start.json.id === "string" ? start.json.id : "";
  if (!exportId) throw new Error("Export id missing from Power BI.");

  const deadline = Date.now() + EXPORT_TIMEOUT_MS;
  let status = "NotStarted";
  while (Date.now() < deadline) {
    const poll = await powerBiApiRequest(
      `/groups/${workspaceId}/reports/${powerBiReportId}/exports/${exportId}`,
    );
    if (!poll.ok) throw new Error(poll.text.slice(0, 300) || "Export status failed.");
    status = typeof poll.json.status === "string" ? poll.json.status : status;
    if (status === "Succeeded") break;
    if (status === "Failed") throw new Error("Power BI export failed.");
    await new Promise((r) => setTimeout(r, EXPORT_POLL_MS));
  }
  if (status !== "Succeeded") throw new Error("Export timed out.");

  const apiToken = await acquirePowerBiServiceToken();
  const fileRes = await fetch(
    `https://api.powerbi.com/v1.0/myorg/groups/${workspaceId}/reports/${powerBiReportId}/exports/${exportId}/file`,
    {
      headers: { Authorization: `Bearer ${apiToken}` },
      cache: "no-store",
    },
  );
  if (!fileRes.ok) throw new Error("Could not download exported file.");
  const bytes = await fileRes.arrayBuffer();
  const ext = format === "PPTX" ? "pptx" : format === "PDF" ? "pdf" : format.toLowerCase();
  const baseName = (report.title ?? report.name ?? "report").replace(/[^\w\-]+/g, "_");
  return {
    bytes,
    contentType: fileRes.headers.get("content-type") || "application/octet-stream",
    fileName: `${baseName}.${ext}`,
  };
}

export async function handleBiEmbedGet(request: NextRequest, path: string[]): Promise<NextResponse> {
  const catalogReportId = path[4];
  try {
    const auth = await authenticateForCatalogReport(request.headers.get("authorization"), catalogReportId);
    if (auth instanceof NextResponse) return auth;

    const dto = await issueEmbedTokenForReport(
      auth.report,
      auth.email,
      auth.isSuperAdmin,
      catalogReportId,
      auth.userId,
    );
    if (dto instanceof NextResponse) return dto;

    await recordReportAccess(auth.userId, catalogReportId);
    return NextResponse.json(dto);
  } catch (error) {
    const err = error as Error;
    if (err instanceof RlsRolesRequiredError) {
      return NextResponse.json({ message: err.message }, { status: 403 });
    }
    return NextResponse.json(
      {
        message: "Could not issue embed token.",
        detail: process.env.NODE_ENV === "development" ? err.message : undefined,
      },
      { status: 502 },
    );
  }
}

export async function handleBiDownloadPost(request: NextRequest, path: string[]): Promise<NextResponse> {
  const catalogReportId = path[5];
  try {
    const auth = await authenticateForCatalogReport(request.headers.get("authorization"), catalogReportId);
    if (auth instanceof NextResponse) return auth;

    if (!servicePrincipalConfigured()) {
      return NextResponse.json({ message: "Power BI export is not configured on the portal." }, { status: 502 });
    }

    let body: Record<string, unknown> = {};
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      body = {};
    }

    if (!normalizeExportFormat(body.exportFileFormat ?? body.ExportFileFormat)) {
      return NextResponse.json({ message: "exportFileFormat is required" }, { status: 400 });
    }

    const file = await exportReportFile(auth.report, auth.email, auth.isSuperAdmin, body);
    return new NextResponse(file.bytes, {
      status: 200,
      headers: {
        "Content-Type": file.contentType,
        "Content-Disposition": `attachment; filename="${file.fileName}"`,
      },
    });
  } catch (error) {
    const err = error as Error;
    if (err instanceof RlsRolesRequiredError) {
      return NextResponse.json({ message: err.message }, { status: 403 });
    }
    if (err.message === "exportFileFormat is required") {
      return NextResponse.json({ message: err.message }, { status: 400 });
    }
    return NextResponse.json(
      {
        message: "Could not export report.",
        detail: process.env.NODE_ENV === "development" ? err.message : undefined,
      },
      { status: 502 },
    );
  }
}
