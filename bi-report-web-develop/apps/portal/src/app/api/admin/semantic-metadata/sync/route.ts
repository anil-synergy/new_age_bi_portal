import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, requireSystemAdmin } from "@/lib/server/bi-admin-auth";
import { callSemanticMetadataSync } from "@/lib/server/semantic-metadata-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600;

export async function POST(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (admin instanceof NextResponse) return admin;
  const denied = requireSystemAdmin(admin);
  if (denied) return denied;

  let mode: "full" | "incremental" = "incremental";
  try {
    const body = (await request.json()) as { mode?: unknown };
    if (body?.mode === "full" || body?.mode === "incremental") mode = body.mode;
  } catch {
    // default incremental
  }

  const result = await callSemanticMetadataSync(mode);
  const httpStatus = typeof result.httpStatus === "number" ? result.httpStatus : result.status === "ok" ? 200 : 502;
  return NextResponse.json(result, { status: httpStatus });
}
