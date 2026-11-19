import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, requireSystemAdmin } from "@/lib/server/bi-admin-auth";
import { fetchSemanticMetadataStatus } from "@/lib/server/semantic-metadata-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (admin instanceof NextResponse) return admin;
  const denied = requireSystemAdmin(admin);
  if (denied) return denied;

  const result = await fetchSemanticMetadataStatus();
  const httpStatus = typeof result.httpStatus === "number" ? result.httpStatus : result.status === "ok" ? 200 : 502;
  return NextResponse.json(result, { status: httpStatus });
}
