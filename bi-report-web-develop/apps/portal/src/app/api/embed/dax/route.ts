import { NextRequest, NextResponse } from "next/server";
import { emailFromBearer } from "@/lib/catalog/entra-user";
import { firstGuid, requestDaxQuery } from "@/lib/azure-embed";

export async function POST(request: NextRequest) {
  try {
    const email = await emailFromBearer(request.headers.get("authorization"));
    if (!email) return NextResponse.json({ message: "Sign in required" }, { status: 401 });

    const body = (await request.json()) as {
      workspaceId?: string;
      datasetId?: string;
      daxQuery?: string;
      effectiveIdentity?: { username: string; roles: string[] };
    };
    const workspaceId = firstGuid(body.workspaceId);
    const datasetId = firstGuid(body.datasetId);
    if (!workspaceId || !datasetId || !body.daxQuery) {
      return NextResponse.json({ message: "workspaceId, datasetId and daxQuery are required" }, { status: 400 });
    }

    const results = await requestDaxQuery(workspaceId, datasetId, body.daxQuery, body.effectiveIdentity);
    return NextResponse.json({ results });
  } catch (error) {
    const message = error instanceof Error ? error.message : "DAX execution failed";
    return NextResponse.json({ message }, { status: 502 });
  }
}
