import { NextRequest, NextResponse } from "next/server";
import { emailFromBearer } from "@/lib/catalog/entra-user";
import { firstGuid, requestSemanticModel } from "@/lib/azure-embed";

export async function GET(request: NextRequest) {
  try {
    const email = await emailFromBearer(request.headers.get("authorization"));
    if (!email) return NextResponse.json({ message: "Sign in required" }, { status: 401 });

    const workspaceId = firstGuid(request.nextUrl.searchParams.get("workspaceId"));
    const reportId = firstGuid(request.nextUrl.searchParams.get("reportId"));
    const datasetId = firstGuid(request.nextUrl.searchParams.get("datasetId"));
    if (!workspaceId || !reportId) {
      return NextResponse.json({ message: "workspaceId and reportId are required" }, { status: 400 });
    }

    const model = await requestSemanticModel(workspaceId, reportId, datasetId);
    return NextResponse.json({ model });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch semantic model";
    return NextResponse.json({ message }, { status: 502 });
  }
}
