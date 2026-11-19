import { NextRequest, NextResponse } from "next/server";
import { emailFromBearer } from "@/lib/catalog/entra-user";
import {
  invalidateCatalogCache,
  loadCatalogForEmail,
  toggleFavoriteForUser,
} from "@/lib/catalog/reports-catalog";

const SIGN_IN_REQUIRED = { message: "Sign in required" } as const;
const UNAUTHORIZED = { message: "Unauthorized" } as const;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isBiFavoritePath(method: string, path: string[]): boolean {
  if (method !== "PUT") return false;
  if (path.length < 4) return false;
  if (path[0] !== "bi-report-api" || path[1] !== "v1") return false;
  return path.slice(2).join("/") === "report/favoriteReport";
}

export async function handleBiFavorite(request: NextRequest): Promise<NextResponse> {
  const authorization = request.headers.get("authorization");
  let email: string | null;
  try {
    email = await emailFromBearer(authorization);
  } catch {
    return NextResponse.json(SIGN_IN_REQUIRED, { status: 401 });
  }
  if (!email || !authorization) {
    return NextResponse.json(SIGN_IN_REQUIRED, { status: 401 });
  }

  const reportId = request.nextUrl.searchParams.get("reportId")?.trim() ?? "";
  if (!UUID_RE.test(reportId)) {
    return NextResponse.json({ message: "reportId is required" }, { status: 400 });
  }

  try {
    const catalog = await loadCatalogForEmail(email);
    if (!catalog.userFound || !catalog.userInfo.id) {
      return NextResponse.json(UNAUTHORIZED, { status: 401 });
    }

    await toggleFavoriteForUser(catalog.userInfo.id, catalog.userInfo.name ?? email, reportId);
    invalidateCatalogCache(email);
    const refreshed = await loadCatalogForEmail(email);
    return NextResponse.json(refreshed.reports);
  } catch (error) {
    const err = error as Error & { code?: string };
    return NextResponse.json(
      {
        message: "Could not update favorite.",
        detail: process.env.NODE_ENV === "development" ? err.message : undefined,
        code: err.code,
      },
      { status: 500 },
    );
  }
}
