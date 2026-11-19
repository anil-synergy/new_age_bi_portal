import { NextRequest, NextResponse } from "next/server";
import { emailFromBearer } from "@/lib/catalog/entra-user";
import { loadCatalogForEmail } from "@/lib/catalog/reports-catalog";

export async function GET(request: NextRequest) {
  try {
    const authorization = request.headers.get("authorization");
    const email = await emailFromBearer(authorization);
    if (!email || !authorization) {
      return NextResponse.json({ message: "Sign in required" }, { status: 401 });
    }

    const catalog = await loadCatalogForEmail(email);

    return NextResponse.json(
      { userInfo: catalog.userInfo, reports: catalog.reports },
      { headers: { "X-Catalog-Source": "database" } },
    );
  } catch (error) {
    const err = error as Error & { code?: string };
    console.error(`[catalog] load failed: ${err.code ?? err.name}: ${err.message}`);
    const isTimeout =
      err.code === "ETIMEDOUT" ||
      err.message?.toLowerCase().includes("timeout") ||
      err.message?.toLowerCase().includes("connect");

    return NextResponse.json(
      {
        message: isTimeout
          ? "Could not reach the BI database. Check VPN and network access."
          : "Could not load reports from the database.",
        detail: process.env.NODE_ENV === "development" ? err.message : undefined,
        code: err.code,
      },
      { status: 500 },
    );
  }
}