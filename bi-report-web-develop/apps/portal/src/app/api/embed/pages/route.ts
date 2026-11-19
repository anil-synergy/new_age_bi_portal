import { NextRequest, NextResponse } from "next/server";
import { emailFromBearer } from "@/lib/catalog/entra-user";
import { firstGuid, requestReportPages } from "@/lib/azure-embed";

export async function GET(request: NextRequest) {
  try {
    const email = await emailFromBearer(request.headers.get("authorization"));
    if (!email) return NextResponse.json({ message: "Sign in required" }, { status: 401 });

    const workspaceId = firstGuid(request.nextUrl.searchParams.get("workspaceId"));
    const reportId = firstGuid(request.nextUrl.searchParams.get("reportId"));
    if (!workspaceId || !reportId) {
      return NextResponse.json({ message: "workspaceId and reportId are required" }, { status: 400 });
    }

    const pages = await requestReportPages(workspaceId, reportId);
    return NextResponse.json({ pages });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch report pages";
    return NextResponse.json({ message }, { status: 502 });
  }
}
