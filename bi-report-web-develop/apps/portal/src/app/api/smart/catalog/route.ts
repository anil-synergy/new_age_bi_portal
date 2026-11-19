import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { loadAllActiveReports } from "@/lib/catalog/reports-catalog";
import { resolveDatasetForEmbed } from "@/lib/catalog/dataset-from-catalog";
import { isFabricRayfinCatalogReport } from "@/lib/catalog/fabric-rayfin-detect";
import { firstGuid } from "@/lib/azure-embed/ids";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Audience reserved for the SMART metadata sync; distinct from the chat audience. */
const CATALOG_AUDIENCE = "bi-portal-catalog";
const CATALOG_ISSUER = "smart-sync";

function unauthorized() {
  return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
}

async function verifyServiceToken(authorization: string | null): Promise<boolean> {
  const secret = process.env.SMART_ORCHESTRATOR_SECRET;
  if (!secret || !authorization?.toLowerCase().startsWith("bearer ")) return false;
  try {
    await jwtVerify(authorization.slice(7).trim(), new TextEncoder().encode(secret), {
      algorithms: ["HS256"],
      issuer: CATALOG_ISSUER,
      audience: CATALOG_AUDIENCE,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Full portal menu catalogue for the SMART metadata sync (service-to-service only).
 * Returns every active report with its menu path and Power BI ids. No per-user filtering:
 * user entitlement is applied on the chat path, not here.
 */
export async function GET(request: NextRequest) {
  if (!(await verifyServiceToken(request.headers.get("authorization")))) return unauthorized();

  try {
    const reports = await loadAllActiveReports();
    const items = reports.map((report) => {
      const workspaceId = report.workspaceId ?? report.powerWorkSpaceId;
      const path = report.categoryPath?.map((p) => p.name) ?? [];
      const fabric = isFabricRayfinCatalogReport(report);
      const dbSemantic = firstGuid(report.semanticModelId, report.datasetId);
      let datasetId = dbSemantic;
      if (!datasetId && workspaceId && !fabric) {
        datasetId = firstGuid(
          resolveDatasetForEmbed({
            workspaceId,
            powerBiReportId: report.powerBiReportId,
            portalCatalogId: report.id,
            titles: [report.title],
          }).datasetId,
        );
      }
      const smartInScope = !fabric && Boolean(datasetId);
      return {
        portal_id: report.id,
        title: report.title,
        description: report.description ?? null,
        category_name: report.categoryName ?? null,
        menu_path: path.join(" > ") || report.categoryName || null,
        category_path: path,
        workspace_id: workspaceId ?? null,
        report_id: report.powerBiReportId ?? null,
        dataset_id: datasetId ?? null,
        application_type: report.applicationType ?? (fabric ? "fabric-rayfin" : "power-bi"),
        smart_in_scope: smartInScope,
      };
    });
    return NextResponse.json(
      { generated_at: new Date().toISOString(), count: items.length, reports: items },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch {
    return NextResponse.json({ message: "Catalogue unavailable" }, { status: 503 });
  }
}
