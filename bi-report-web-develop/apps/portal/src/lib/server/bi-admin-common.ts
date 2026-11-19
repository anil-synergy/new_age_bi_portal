import { NextResponse } from "next/server";
import { getDevDbPool } from "@/lib/catalog/dev-db";
import { invalidateAllCatalogCaches, invalidateCatalogCache } from "@/lib/catalog/reports-catalog";

export const SIGN_IN_REQUIRED = { message: "Sign in required" } as const;
export const UNAUTHORIZED = { message: "Unauthorized" } as const;
export const FORBIDDEN = { message: "Forbidden" } as const;

export const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const EMPTY_GUID = "00000000-0000-0000-0000-000000000000";
export const SYSTEM_ADMIN = "System Admin";
export const REPORT_PERMISSION_VIEWER = 0;

export type PagedRequest = {
  page?: number;
  pageSize?: number;
  search?: string;
  filterValue?: string | null;
};

export type PageModel<T> = {
  currentPage: number;
  totalItems: number;
  totalPages: number;
  items: T[];
  pageSize: number;
  hasNext: boolean;
  hasPrev: boolean;
  totalCount: number;
};

export function getDb() {
  return getDevDbPool();
}

export function auditUserJson(userId: string, userName: string): string {
  return JSON.stringify({ Id: userId, Name: userName || userId });
}

export function jsonOk<T>(body: T, status = 200) {
  return NextResponse.json(body, { status });
}

export function paginate<T>(all: T[], page: number, pageSize: number): PageModel<T> {
  const size = Math.max(1, pageSize || 20);
  const currentPage = Math.max(1, page || 1);
  const totalItems = all.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / size));
  const safePage = Math.min(currentPage, totalPages);
  const start = (safePage - 1) * size;
  const items = all.slice(start, start + size);
  return {
    currentPage: safePage,
    totalItems,
    totalPages,
    totalCount: totalItems,
    pageSize: size,
    items,
    hasNext: safePage < totalPages,
    hasPrev: safePage > 1,
  };
}

export function normalizePaged(input: PagedRequest | null | undefined): Required<Pick<PagedRequest, "page" | "pageSize" | "search">> & {
  filterValue: string | null;
} {
  const page = Math.max(1, Number(input?.page) || 1);
  const pageSize = Math.max(1, Number(input?.pageSize) || 20);
  const search = (input?.search ?? "").trim();
  const filterValue = input?.filterValue?.trim() ? String(input.filterValue).trim() : null;
  return { page, pageSize, search, filterValue };
}

export async function readJsonBody<T>(request: Request): Promise<T | null> {
  try {
    const text = await request.text();
    if (!text.trim()) return null;
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

export function pagedFromQuery(url: URL): PagedRequest {
  return {
    page: Number(url.searchParams.get("page") || 1),
    pageSize: Number(url.searchParams.get("pageSize") || 20),
    search: url.searchParams.get("search") ?? "",
    filterValue: url.searchParams.get("filterValue"),
  };
}

export function matchesSearch(haystack: string, needle: string): boolean {
  if (!needle) return true;
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

export function invalidateAfterAdminWrite(email: string) {
  invalidateCatalogCache(email);
  invalidateAllCatalogCaches();
}

export async function departmentCategoryIds(userId: string): Promise<string[]> {
  const db = getDb();
  try {
    const res = await db.query<{ id: string }>(
      `SELECT id::text
       FROM bi_report_categories
       WHERE is_active = true
         AND department_admin IS NOT NULL
         AND (
           department_admin @> to_jsonb($1::text)
           OR department_admin @> to_jsonb($1::uuid)
         )`,
      [userId],
    );
    return res.rows.map((r) => r.id);
  } catch {
    return [];
  }
}

export async function softDeleteRow(table: string, id: string, audit: string) {
  const db = getDb();
  await db.query(
    `UPDATE ${table}
     SET is_active = false, deleted_at = NOW(), deleted_by = $2::jsonb, updated_at = NOW(), updated_by = $2::jsonb
     WHERE id = $1`,
    [id, audit],
  );
}
