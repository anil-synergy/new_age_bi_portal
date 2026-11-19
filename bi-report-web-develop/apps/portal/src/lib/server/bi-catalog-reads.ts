import { NextRequest, NextResponse } from "next/server";
import { emailFromBearer } from "@/lib/catalog/entra-user";
import { loadCatalogForEmail } from "@/lib/catalog/reports-catalog";

const SIGN_IN_REQUIRED = { message: "Sign in required" } as const;
const UNAUTHORIZED = { message: "Unauthorized" } as const;

function catalogReadSuffix(path: string[]): string | null {
  if (path.length < 3) return null;
  if (path[0] !== "bi-report-api" || path[1] !== "v1") return null;
  const rest = path.slice(2).join("/");
  if (rest === "user/userInfo" || rest === "report/reports") return rest;
  return null;
}

/** GET userInfo and GET reports under bi-report-api/v1 (segments after /api/bi/). */
export function isBiCatalogReadPath(method: string, path: string[]): boolean {
  if (method !== "GET") return false;
  return catalogReadSuffix(path) !== null;
}

/** Serves GET userInfo / GET reports from Postgres without calling bi-report-api. */
export async function handleBiCatalogRead(request: NextRequest, path: string[]): Promise<NextResponse> {
  const suffix = catalogReadSuffix(path);
  if (!suffix) {
    return NextResponse.json({ message: "Not found" }, { status: 404 });
  }

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

  try {
    const catalog = await loadCatalogForEmail(email);
    if (!catalog.userFound) {
      return NextResponse.json(UNAUTHORIZED, { status: 401 });
    }
    if (suffix === "user/userInfo") {
      return NextResponse.json(catalog.userInfo);
    }
    return NextResponse.json(catalog.reports);
  } catch (error) {
    const err = error as Error & { code?: string };
    return NextResponse.json(
      {
        message: "Could not load from the BI database.",
        detail: process.env.NODE_ENV === "development" ? err.message : undefined,
        code: err.code,
      },
      { status: 500 },
    );
  }
}
