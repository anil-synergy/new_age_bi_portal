import { NextRequest, NextResponse } from "next/server";
import { emailFromBearer } from "@/lib/catalog/entra-user";
import { resolveCatalogReportForUser } from "@/lib/catalog/reports-catalog";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const authorization = request.headers.get("authorization");
    const email = await emailFromBearer(authorization);
    if (!email || !authorization) {
      return NextResponse.json({ message: "Sign in required" }, { status: 401 });
    }

    const { id } = await context.params;
    const catalogId = id?.trim();
    if (!catalogId) {
      return NextResponse.json({ message: "Report id required" }, { status: 400 });
    }

    const report = await resolveCatalogReportForUser(email, catalogId);
    if (!report) {
      return NextResponse.json({ message: "Report not found or access denied" }, { status: 404 });
    }

    return NextResponse.json(report);
  } catch (error) {
    const err = error as Error & { code?: string };
    const isTimeout =
      err.code === "ETIMEDOUT" ||
      err.message?.toLowerCase().includes("timeout") ||
      err.message?.toLowerCase().includes("connect");

    return NextResponse.json(
      {
        message: isTimeout
          ? "Could not reach the BI database. Check VPN and network access."
          : "Could not load report from the database.",
        detail: process.env.NODE_ENV === "development" ? err.message : undefined,
        code: err.code,
      },
      { status: 500 }
    );
  }
}