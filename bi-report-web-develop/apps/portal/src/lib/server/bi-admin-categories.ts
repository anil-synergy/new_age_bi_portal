import { NextResponse } from "next/server";
import type { AdminContext } from "./bi-admin-auth";
import {
  auditUserJson,
  EMPTY_GUID,
  getDb,
  invalidateAfterAdminWrite,
  jsonOk,
  matchesSearch,
  normalizePaged,
  pagedFromQuery,
  readJsonBody,
  softDeleteRow,
  UUID_RE,
  type PageModel,
  type PagedRequest,
} from "./bi-admin-common";
import { categoryHierarchyColumnsExist, resetCategoryHierarchyProbeForAdmin } from "./bi-admin-category-hierarchy";
import { ensureCategoryHierarchyColumns, resetPhase6SchemaCacheForTests } from "./bi-admin-schema";

export { resetPhase6SchemaCacheForTests, resetCategoryHierarchyProbeForAdmin };

type DepartmentAdmin = { id: string; name?: string; email?: string };
type CategoryDto = {
  id: string;
  name: string;
  description?: string;
  parentId?: string | null;
  parentName?: string;
  path?: string;
  displayOrder?: number;
  departmentAdmin?: DepartmentAdmin[];
};

const DEFAULT_LIST: PagedRequest = { page: 1, pageSize: 20, search: "" };

async function enrichDepartmentAdminsMap(ids: string[]): Promise<Map<string, DepartmentAdmin>> {
  const validIds = [...new Set(ids.filter((id) => UUID_RE.test(id)))];
  const map = new Map<string, DepartmentAdmin>();
  if (!validIds.length) return map;
  const db = getDb();
  try {
    const res = await db.query<{ id: string; name: string; email_address: string }>(
      `SELECT id::text, name, email_address FROM users WHERE id = ANY($1::uuid[]) AND is_active = true`,
      [validIds],
    );
    for (const u of res.rows) {
      map.set(u.id, { id: u.id, name: u.name, email: u.email_address });
    }
  } catch {
    return map;
  }
  return map;
}

function parseDepartmentAdminJson(raw: unknown): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw.flatMap((item) => {
      if (typeof item === "string" && item.trim()) return [item.trim()];
      if (item && typeof item === "object") {
        const row = item as { id?: string; Id?: string };
        const id = row.id?.trim() || row.Id?.trim();
        return id ? [id] : [];
      }
      const asString = String(item).trim();
      return asString && asString !== "[object Object]" ? [asString] : [];
    });
  }
  return [];
}

type CategoryRow = {
  id: string;
  name: string;
  description: string | null;
  department_admin: unknown;
  parent_id: string | null;
  display_order: number;
};

function normalizeParentId(raw: string | null | undefined): string | null {
  const trimmed = raw?.trim();
  if (!trimmed || trimmed === EMPTY_GUID) return null;
  return trimmed;
}

function categoryPathLabel(
  byId: Map<string, { name: string; parentId: string | null }>,
  id: string,
): string {
  const parts: string[] = [];
  let cur: string | undefined = id;
  const seen = new Set<string>();
  while (cur && byId.has(cur) && !seen.has(cur) && parts.length < 32) {
    seen.add(cur);
    const node = byId.get(cur)!;
    parts.push(node.name);
    cur = node.parentId ?? undefined;
  }
  return parts.reverse().join(" › ");
}

async function wouldCreateCategoryCycle(
  byId: Map<string, { parentId: string | null }>,
  categoryId: string | undefined,
  parentId: string,
): Promise<boolean> {
  if (categoryId && parentId === categoryId) return true;
  let cursor: string | null = parentId;
  const seen = new Set<string>();
  while (cursor && !seen.has(cursor)) {
    if (categoryId && cursor === categoryId) return true;
    seen.add(cursor);
    cursor = byId.get(cursor)?.parentId ?? null;
  }
  return false;
}

async function loadCategoryRows(ctx: AdminContext): Promise<CategoryRow[]> {
  const hasHierarchy = await categoryHierarchyColumnsExist();
  const db = getDb();
  const res = hasHierarchy
    ? await db.query<CategoryRow>(
        `SELECT id::text, name, description, department_admin, parent_id::text, COALESCE(display_order, 0) AS display_order
         FROM bi_report_categories
         WHERE is_active = true
         ORDER BY display_order, lower(name)`,
      )
    : await db.query<{
        id: string;
        name: string;
        description: string | null;
        department_admin: unknown;
      }>(
        `SELECT id::text, name, description, department_admin
         FROM bi_report_categories
         WHERE is_active = true
         ORDER BY lower(name)`,
      );
  let rows: CategoryRow[] = hasHierarchy
    ? res.rows
    : res.rows.map((r) => ({
        ...r,
        parent_id: null,
        display_order: 0,
      }));
  if (!ctx.isSuperAdmin && ctx.departmentCategoryIds.length) {
    const allowed = new Set(ctx.departmentCategoryIds);
    rows = rows.filter((r) => allowed.has(r.id));
  }
  return rows;
}

async function loadCategories(ctx: AdminContext): Promise<CategoryDto[]> {
  const rows = await loadCategoryRows(ctx);
  const byId = new Map(
    rows.map((r) => [r.id, { name: r.name, parentId: normalizeParentId(r.parent_id) }]),
  );
  const allAdminIds = rows.flatMap((row) => parseDepartmentAdminJson(row.department_admin));
  const adminMap = await enrichDepartmentAdminsMap(allAdminIds);
  return rows.map((row) => {
    const parentId = normalizeParentId(row.parent_id);
    const adminIds = parseDepartmentAdminJson(row.department_admin);
    return {
      id: row.id,
      name: row.name,
      description: row.description ?? undefined,
      parentId,
      parentName: parentId ? byId.get(parentId)?.name : undefined,
      path: categoryPathLabel(byId, row.id),
      displayOrder: row.display_order ?? 0,
      departmentAdmin: adminIds.flatMap((id) => {
        const admin = adminMap.get(id);
        return admin ? [admin] : [];
      }),
    };
  });
}

export async function listCategoriesPaged(ctx: AdminContext, paged: PagedRequest): Promise<PageModel<CategoryDto>> {
  const { page, pageSize, search } = normalizePaged(paged);
  const all = await loadCategories(ctx);
  const filtered = all.filter(
    (c) =>
      matchesSearch(c.name, search) ||
      matchesSearch(c.description ?? "", search) ||
      matchesSearch(c.path ?? "", search),
  );
  const totalItems = filtered.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const offset = (safePage - 1) * pageSize;
  const items = filtered.slice(offset, offset + pageSize);
  return {
    currentPage: safePage,
    totalItems,
    totalPages,
    totalCount: totalItems,
    pageSize,
    items,
    hasNext: safePage < totalPages,
    hasPrev: safePage > 1,
  };
}

export async function listAllCategories(ctx: AdminContext) {
  return loadCategories(ctx);
}

type CategoryBody = {
  id?: string;
  name?: string;
  description?: string;
  parentId?: string | null;
  displayOrder?: number;
  departmentAdmin?: DepartmentAdmin[];
};

function adminIdsFromBody(body: CategoryBody): string[] | null {
  const ids =
    body.departmentAdmin
      ?.map((a) => a.id?.trim())
      .filter((id) => id && id !== EMPTY_GUID) ?? [];
  return ids.length ? ids : null;
}

async function resolveParentForSave(
  ctx: AdminContext,
  body: CategoryBody,
  categoryId: string | undefined,
): Promise<
  | { ok: true; parentId: string | null; displayOrder: number; hasHierarchy: boolean }
  | { ok: false; response: NextResponse }
> {
  const parentId = normalizeParentId(body.parentId ?? undefined);
  const displayOrder = Number.isFinite(body.displayOrder) ? Number(body.displayOrder) : 0;

  if (parentId && !UUID_RE.test(parentId)) {
    return { ok: false, response: jsonOk({ message: "Parent folder must be a valid category" }, 400) };
  }

  let hasHierarchy = await categoryHierarchyColumnsExist();

  if (parentId && !hasHierarchy) {
    try {
      await ensureCategoryHierarchyColumns();
      hasHierarchy = await categoryHierarchyColumnsExist();
      resetCategoryHierarchyProbeForAdmin();
    } catch {
      return {
        ok: false,
        response: jsonOk(
          {
            message:
              "Parent folder requires hierarchy columns on bi_report_categories. Ask a DBA to run apps/portal/scripts/migrate-category-hierarchy.sql or save without a parent.",
          },
          400,
        ),
      };
    }
    if (!hasHierarchy) {
      return {
        ok: false,
        response: jsonOk(
          {
            message:
              "Parent folder is not supported until hierarchy columns exist. Save as a root category or apply the migration script.",
          },
          400,
        ),
      };
    }
  }

  const rows = await loadCategoryRows(ctx);
  const byId = new Map(rows.map((r) => [r.id, { parentId: normalizeParentId(r.parent_id) }]));

  if (parentId) {
    if (!byId.has(parentId)) {
      return { ok: false, response: jsonOk({ message: "Parent folder not found" }, 400) };
    }
    if (await wouldCreateCategoryCycle(byId, categoryId, parentId)) {
      return { ok: false, response: jsonOk({ message: "Parent folder would create a cycle in the hierarchy" }, 400) };
    }
  }

  return { ok: true, parentId, displayOrder, hasHierarchy };
}

export async function saveCategory(ctx: AdminContext, body: CategoryBody, categoryId?: string) {
  const name = body.name?.trim() ?? "";
  if (!name) return jsonOk({ message: "Name is required" }, 400);

  const resolved = await resolveParentForSave(ctx, body, categoryId);
  if (!resolved.ok) return resolved.response;

  const { parentId, displayOrder, hasHierarchy } = resolved;
  const audit = auditUserJson(ctx.userId, ctx.userName);
  const adminIds = adminIdsFromBody(body);
  const adminParam = adminIds ? JSON.stringify(adminIds) : null;
  const db = getDb();

  if (categoryId) {
    if (hasHierarchy) {
      const res = await db.query(
        `UPDATE bi_report_categories
         SET name = $2, description = $3, department_admin = $4::jsonb, parent_id = $5, display_order = $6,
             updated_at = NOW(), updated_by = $7::jsonb
         WHERE id = $1 AND is_active = true`,
        [categoryId, name, body.description?.trim() ?? "", adminParam, parentId, displayOrder, audit],
      );
      if ((res.rowCount ?? 0) === 0) return jsonOk({ message: "Category not found" }, 404);
    } else {
      const res = await db.query(
        `UPDATE bi_report_categories
         SET name = $2, description = $3, department_admin = $4::jsonb, updated_at = NOW(), updated_by = $5::jsonb
         WHERE id = $1 AND is_active = true`,
        [categoryId, name, body.description?.trim() ?? "", adminParam, audit],
      );
      if ((res.rowCount ?? 0) === 0) return jsonOk({ message: "Category not found" }, 404);
    }
  } else {
    const id = body.id && body.id !== EMPTY_GUID ? body.id : crypto.randomUUID();
    if (hasHierarchy) {
      await db.query(
        `INSERT INTO bi_report_categories (id, name, description, department_admin, parent_id, display_order, is_active, created_at, updated_at, created_by, updated_by)
         VALUES ($1, $2, $3, $4::jsonb, $5, $6, true, NOW(), NOW(), $7::jsonb, $7::jsonb)`,
        [id, name, body.description?.trim() ?? "", adminParam, parentId, displayOrder, audit],
      );
    } else {
      await db.query(
        `INSERT INTO bi_report_categories (id, name, description, department_admin, is_active, created_at, updated_at, created_by, updated_by)
         VALUES ($1, $2, $3, $4::jsonb, true, NOW(), NOW(), $5::jsonb, $5::jsonb)`,
        [id, name, body.description?.trim() ?? "", adminParam, audit],
      );
    }
  }
  invalidateAfterAdminWrite(ctx.email);
  return jsonOk(await listCategoriesPaged(ctx, DEFAULT_LIST));
}

export async function deleteCategory(ctx: AdminContext, categoryId: string) {
  if (!ctx.isSuperAdmin) {
    const { FORBIDDEN } = await import("./bi-admin-common");
    return NextResponse.json(FORBIDDEN, { status: 403 });
  }
  const audit = auditUserJson(ctx.userId, ctx.userName);
  await softDeleteRow("bi_report_categories", categoryId, audit);
  invalidateAfterAdminWrite(ctx.email);
  return jsonOk(await listCategoriesPaged(ctx, DEFAULT_LIST));
}

export async function handleCategoriesGet(ctx: AdminContext, request: Request, subpath: string) {
  if (subpath === "report/categories") {
    return jsonOk(await listAllCategories(ctx));
  }
  if (subpath === "report/category") {
    return jsonOk(await listCategoriesPaged(ctx, pagedFromQuery(new URL(request.url))));
  }
  return null;
}

export async function handleCategoriesPost(ctx: AdminContext, request: Request, subpath: string) {
  if (subpath !== "report/category") return null;
  const body = await readJsonBody<CategoryBody>(request);
  if (!body) return jsonOk({ message: "Invalid body" }, 400);
  return saveCategory(ctx, body);
}

export async function handleCategoriesPut(ctx: AdminContext, request: Request, subpath: string) {
  const match = subpath.match(/^report\/category\/([^/]+)$/);
  if (!match) return null;
  const body = await readJsonBody<CategoryBody>(request);
  if (!body) return jsonOk({ message: "Invalid body" }, 400);
  return saveCategory(ctx, body, match[1]);
}

export async function handleCategoriesDelete(ctx: AdminContext, subpath: string) {
  const match = subpath.match(/^report\/category\/([^/]+)$/);
  if (!match) return null;
  return deleteCategory(ctx, match[1]);
}