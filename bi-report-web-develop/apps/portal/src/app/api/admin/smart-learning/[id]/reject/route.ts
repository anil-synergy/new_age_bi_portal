import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, requireSystemAdmin } from "@/lib/server/bi-admin-auth";
import { rejectLearningProposal } from "@/lib/server/smart-learning-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const admin = await requireAdmin(request);
  if (admin instanceof NextResponse) return admin;
  const denied = requireSystemAdmin(admin);
  if (denied) return denied;
  const body = (await request.json().catch(() => ({}))) as { reason?: string };
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (!reason) return NextResponse.json({ message: "reason required" }, { status: 400 });
  const result = await rejectLearningProposal(admin.email, id, reason);
  const status = typeof result.httpStatus === "number" ? result.httpStatus : 502;
  return NextResponse.json(result, { status });
}