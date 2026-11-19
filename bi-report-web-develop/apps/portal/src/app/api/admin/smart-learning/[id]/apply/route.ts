import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, requireSystemAdmin } from "@/lib/server/bi-admin-auth";
import { applyLearningProposal } from "@/lib/server/smart-learning-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const admin = await requireAdmin(request);
  if (admin instanceof NextResponse) return admin;
  const denied = requireSystemAdmin(admin);
  if (denied) return denied;
  const result = await applyLearningProposal(admin.email, id);
  const status = typeof result.httpStatus === "number" ? result.httpStatus : 502;
  return NextResponse.json(result, { status });
}