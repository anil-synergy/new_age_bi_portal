import { NextRequest, NextResponse } from "next/server";
import { requestSemanticModel } from "@/lib/azure-embed/function-client";
import { emailFromBearer } from "@/lib/catalog/entra-user";
import { loadCatalogForEmail } from "@/lib/catalog/reports-catalog";
import { getDb, SIGN_IN_REQUIRED, UNAUTHORIZED, UUID_RE } from "./bi-admin-common";

export function isBiSemanticModelPath(method: string, path: string[]): boolean {
  if (method !== "GET") return false;
  if (path.length !== 5) return false;
  if (path[0] !== "bi-report-api" || path[1] !== "v1" || path[2] !== "report") return false;
  return path[4] === "semantic-model" && UUID_RE.test(path[3] ?? "");
}

export async function handleBiSemanticModel(request: NextRequest, path: string[]): Promise<NextResponse> {
  const reportId = path[3];
  const authorization = request.headers.get("authorization");
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
  if (!catalog.userFound) {
    return NextResponse.json(UNAUTHORIZED, { status: 401 });
  }

  let workspaceId: string | undefined;
  let powerBiReportId: string | undefined;
  let datasetId: string | undefined;

  const entitled = catalog.reports.find((r) => r.id.toLowerCase() === reportId.toLowerCase());
  if (entitled) {
    workspaceId = entitled.workspaceId ?? entitled.powerWorkSpaceId;
    powerBiReportId = entitled.powerBiReportId;
    datasetId = entitled.datasetId;
  } else if (catalog.isSuperAdmin) {
    const db = getDb();
    const res = await db.query<{
      powerbi_workspace_id: string;
      powerbi_report_id: string;
    }>(
      `SELECT powerbi_workspace_id::text, powerbi_report_id::text
       FROM bi_report WHERE id = $1 AND is_active = true`,
      [reportId],
    );
    const row = res.rows[0];
    if (!row) {
      return NextResponse.json({ message: "Report not found" }, { status: 404 });
    }
    workspaceId = row.powerbi_workspace_id;
    powerBiReportId = row.powerbi_report_id;
  } else {
    return NextResponse.json({ message: "Report not found" }, { status: 404 });
  }

  if (!workspaceId || !powerBiReportId) {
    return NextResponse.json({ message: "Report is missing Power BI identifiers" }, { status: 422 });
  }

  try {
    const model = await requestSemanticModel(workspaceId, powerBiReportId, datasetId);
    return NextResponse.json(model);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch semantic model";
    return NextResponse.json({ message }, { status: 502 });
  }
}
