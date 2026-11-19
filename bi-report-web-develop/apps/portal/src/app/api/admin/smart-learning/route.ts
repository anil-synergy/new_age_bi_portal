import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, requireSystemAdmin } from "@/lib/server/bi-admin-auth";
import { fetchLearningProposals, generateLearningProposal } from "@/lib/server/smart-learning-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (admin instanceof NextResponse) return admin;
  const denied = requireSystemAdmin(admin);
  if (denied) return denied;
  const result = await fetchLearningProposals(admin.email);
  return NextResponse.json(result, { status: typeof result.httpStatus === "number" && result.httpStatus < 500 ? result.httpStatus : 502 });
}

export async function POST(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (admin instanceof NextResponse) return admin;
  const denied = requireSystemAdmin(admin);
  if (denied) return denied;
  const result = await generateLearningProposal(admin.email);
  return NextResponse.json(result, { status: typeof result.httpStatus === "number" && result.httpStatus < 500 ? result.httpStatus : 502 });
}