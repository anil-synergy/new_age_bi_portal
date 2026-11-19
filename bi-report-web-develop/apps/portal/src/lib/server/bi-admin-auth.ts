import { NextRequest, NextResponse } from "next/server";
import { emailFromBearer } from "@/lib/catalog/entra-user";
import { loadCatalogForEmail } from "@/lib/catalog/reports-catalog";
import { departmentCategoryIds, FORBIDDEN, SIGN_IN_REQUIRED, UNAUTHORIZED } from "./bi-admin-common";

export type AdminContext = {
  email: string;
  userId: string;
  userName: string;
  isSuperAdmin: boolean;
  isDepAdmin: boolean;
  departmentCategoryIds: string[];
};

export type CatalogUserContext = {
  email: string;
  userId: string;
  userName: string;
  isSuperAdmin: boolean;
};

export async function requireCatalogUser(request: NextRequest): Promise<NextResponse | CatalogUserContext> {
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

  const catalog = await loadCatalogForEmail(email);
  if (!catalog.userFound || !catalog.userInfo.id) {
    return NextResponse.json(UNAUTHORIZED, { status: 401 });
  }

  return {
    email,
    userId: catalog.userInfo.id,
    userName: catalog.userInfo.name ?? email,
    isSuperAdmin: catalog.isSuperAdmin,
  };
}

export async function requireAdmin(request: NextRequest): Promise<NextResponse | AdminContext> {
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

  const catalog = await loadCatalogForEmail(email);
  if (!catalog.userFound || !catalog.userInfo.id) {
    return NextResponse.json(UNAUTHORIZED, { status: 401 });
  }
  if (!catalog.isSuperAdmin && !catalog.isDepAdmin) {
    return NextResponse.json(FORBIDDEN, { status: 403 });
  }

  let deptIds: string[] = [];
  if (catalog.isDepAdmin && !catalog.isSuperAdmin) {
    deptIds = await departmentCategoryIds(catalog.userInfo.id);
  }

  return {
    email,
    userId: catalog.userInfo.id,
    userName: catalog.userInfo.name ?? email,
    isSuperAdmin: catalog.isSuperAdmin,
    isDepAdmin: catalog.isDepAdmin,
    departmentCategoryIds: deptIds,
  };
}

export function requireSystemAdmin(ctx: AdminContext): NextResponse | null {
  if (!ctx.isSuperAdmin) {
    return NextResponse.json(FORBIDDEN, { status: 403 });
  }
  return null;
}
