import { NextResponse } from "next/server";
import type { AdminContext } from "./bi-admin-auth";
import {
  auditUserJson,
  getDb,
  invalidateAfterAdminWrite,
  jsonOk,
  matchesSearch,
  normalizePaged,
  pagedFromQuery,
  readJsonBody,
  softDeleteRow,
  type PageModel,
  type PagedRequest,
} from "./bi-admin-common";

type GroupRow = {
  id: string;
  name: string;
  description?: string;
  reportCategory: string;
  reportCategoryName?: string;
  createdBy?: string;
  createdAt?: string;
  updatedBy?: string;
  updatedAt?: string;
  mappedUsers?: unknown[];
  mappedReports?: unknown[];
};

type GroupCreateRequest = {
  name?: string;
  description?: string;
  reportCategory?: string;
};

const DEFAULT_LIST: PagedRequest = { page: 1, pageSize: 20, search: "" };

async function loadGroupRows(ctx: AdminContext): Promise<GroupRow[]> {
  const db = getDb();
  const res = await db.query<{
    id: string;
    name: string;
    description: string | null;
    report_category: string;
    category_name: string | null;
    created_by: unknown;
    created_at: Date;
    updated_by: unknown;
    updated_at: Date;
  }>(
    `SELECT r.id::text, r.name, r.description, r.report_category::text, c.name AS category_name,
            r.created_by, r.created_at, r.updated_by, r.updated_at
     FROM role r
     LEFT JOIN bi_report_categories c ON c.id = r.report_category
     WHERE r.is_active = true
     ORDER BY lower(r.name)`,
  );
  let rows = res.rows;
  if (!ctx.isSuperAdmin && ctx.departmentCategoryIds.length) {
    const allowed = new Set(ctx.departmentCategoryIds);
    rows = rows.filter((r) => allowed.has(r.report_category));
  }
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description ?? undefined,
    reportCategory: r.report_category,
    reportCategoryName: r.category_name ?? undefined,
    mappedUsers: [],
    mappedReports: [],
  }));
}

export async function listGroupsPaged(ctx: AdminContext, paged: PagedRequest): Promise<PageModel<GroupRow>> {
  const { page, pageSize, search, filterValue } = normalizePaged(paged);
  const db = getDb();
  const pattern = search ? `%${search}%` : null;
  const deptFilter = !ctx.isSuperAdmin && ctx.departmentCategoryIds.length ? ctx.departmentCategoryIds : null;
  const countRes = await db.query<{ n: string }>(
    `SELECT count(*)::text AS n
     FROM role r
     WHERE r.is_active = true
       AND ($1::text IS NULL OR lower(r.name) LIKE lower($1))
       AND ($2::uuid IS NULL OR r.report_category = $2)
       AND ($3::uuid[] IS NULL OR r.report_category = ANY($3::uuid[]))`,
  [pattern, filterValue, deptFilter],
  );
  const totalItems = Number(countRes.rows[0]?.n ?? 0);
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const offset = (safePage - 1) * pageSize;
  const res = await db.query<{
    id: string;
    name: string;
    description: string | null;
    report_category: string;
    category_name: string | null;
    created_by: unknown;
    created_at: Date;
    updated_by: unknown;
    updated_at: Date;
  }>(
    `SELECT r.id::text, r.name, r.description, r.report_category::text, c.name AS category_name,
            r.created_by, r.created_at, r.updated_by, r.updated_at
     FROM role r
     LEFT JOIN bi_report_categories c ON c.id = r.report_category
     WHERE r.is_active = true
       AND ($1::text IS NULL OR lower(r.name) LIKE lower($1))
       AND ($2::uuid IS NULL OR r.report_category = $2)
       AND ($3::uuid[] IS NULL OR r.report_category = ANY($3::uuid[]))
     ORDER BY lower(r.name)
     LIMIT $4 OFFSET $5`,
    [pattern, filterValue, deptFilter, pageSize, offset],
  );
  const items = res.rows.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description ?? undefined,
    reportCategory: r.report_category,
    reportCategoryName: r.category_name ?? undefined,
    mappedUsers: [],
    mappedReports: [],
  }));
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

export async function listAllRoles(ctx: AdminContext) {
  const rows = await loadGroupRows(ctx);
  return rows.map(({ mappedUsers: _m, mappedReports: _r, ...rest }) => rest);
}

export async function createGroup(ctx: AdminContext, body: GroupCreateRequest) {
  const name = body.name?.trim() ?? "";
  const categoryId = body.reportCategory?.trim() ?? "";
  if (!name || !categoryId) {
    return jsonOk({ message: "Name and report category are required" }, 400);
  }
  const audit = auditUserJson(ctx.userId, ctx.userName);
  const db = getDb();
  await db.query(
    `INSERT INTO role (id, name, description, report_category, is_internal, issuer, is_active, created_at, updated_at, created_by, updated_by)
     VALUES (gen_random_uuid(), $1, $2, $3, false, '', true, NOW(), NOW(), $4::jsonb, $4::jsonb)`,
    [name, body.description?.trim() ?? "", categoryId, audit],
  );
  invalidateAfterAdminWrite(ctx.email);
  return jsonOk(await listGroupsPaged(ctx, DEFAULT_LIST));
}

export async function updateGroup(ctx: AdminContext, groupId: string, body: GroupCreateRequest) {
  const name = body.name?.trim() ?? "";
  const categoryId = body.reportCategory?.trim() ?? "";
  if (!name || !categoryId) {
    return jsonOk({ message: "Name and report category are required" }, 400);
  }
  const audit = auditUserJson(ctx.userId, ctx.userName);
  const db = getDb();
  const res = await db.query(
    `UPDATE role
     SET name = $2, description = $3, report_category = $4, updated_at = NOW(), updated_by = $5::jsonb
     WHERE id = $1 AND is_active = true`,
    [groupId, name, body.description?.trim() ?? "", categoryId, audit],
  );
  if ((res.rowCount ?? 0) === 0) {
    return jsonOk({ message: "Group not found" }, 404);
  }
  invalidateAfterAdminWrite(ctx.email);
  return jsonOk(await listGroupsPaged(ctx, DEFAULT_LIST));
}

export async function deleteGroup(ctx: AdminContext, groupId: string) {
  if (!ctx.isSuperAdmin) {
    const { FORBIDDEN } = await import("./bi-admin-common");
    return NextResponse.json(FORBIDDEN, { status: 403 });
  }
  const audit = auditUserJson(ctx.userId, ctx.userName);
  await softDeleteRow("role", groupId, audit);
  invalidateAfterAdminWrite(ctx.email);
  return jsonOk(await listGroupsPaged(ctx, DEFAULT_LIST));
}

type UserGroupMapDto = PagedRequest & { userId?: string[] };

export async function mapUsersToGroup(ctx: AdminContext, groupId: string, body: UserGroupMapDto) {
  const userIds = body.userId ?? [];
  const audit = auditUserJson(ctx.userId, ctx.userName);
  const db = getDb();
  for (const userId of userIds) {
    const exists = await db.query(
      `SELECT 1 FROM user_roles WHERE user_id = $1 AND role_id = $2 AND is_active = true`,
      [userId, groupId],
    );
    if (exists.rows.length) continue;
    await db.query(
      `INSERT INTO user_roles (id, user_id, role_id, is_active, created_at, updated_at, created_by, updated_by)
       VALUES (gen_random_uuid(), $1, $2, true, NOW(), NOW(), $3::jsonb, $3::jsonb)`,
      [userId, groupId, audit],
    );
  }
  invalidateAfterAdminWrite(ctx.email);
  return jsonOk(await listGroupsPaged(ctx, normalizePaged(body)));
}

export async function unmapUserFromGroup(ctx: AdminContext, groupId: string, body: UserGroupMapDto) {
  const userId = body.userId?.[0];
  if (!userId) return jsonOk({ message: "userId required" }, 400);
  const audit = auditUserJson(ctx.userId, ctx.userName);
  const db = getDb();
  await db.query(
    `UPDATE user_roles
     SET is_active = false, deleted_at = NOW(), deleted_by = $3::jsonb, updated_at = NOW(), updated_by = $3::jsonb
     WHERE user_id = $1 AND role_id = $2 AND is_active = true`,
    [userId, groupId, audit],
  );
  invalidateAfterAdminWrite(ctx.email);
  return jsonOk(await listGroupsPaged(ctx, normalizePaged(body)));
}

export async function handleGroupsGet(ctx: AdminContext, request: Request, subpath: string) {
  if (subpath === "role") {
    return jsonOk(await listAllRoles(ctx));
  }
  if (subpath === "user/group") {
    return jsonOk(await listGroupsPaged(ctx, pagedFromQuery(new URL(request.url))));
  }
  return null;
}

export async function handleGroupsPost(ctx: AdminContext, request: Request, subpath: string) {
  if (subpath === "user/group") {
    const body = await readJsonBody<GroupCreateRequest>(request);
    if (!body) return jsonOk({ message: "Invalid body" }, 400);
    return createGroup(ctx, body);
  }
  const mapMatch = subpath.match(/^user\/group\/([^/]+)\/users$/);
  if (mapMatch) {
    const body = await readJsonBody<UserGroupMapDto>(request);
    if (!body) return jsonOk({ message: "Invalid body" }, 400);
    return mapUsersToGroup(ctx, mapMatch[1], body);
  }
  return null;
}

export async function handleGroupsPut(ctx: AdminContext, request: Request, subpath: string) {
  const match = subpath.match(/^user\/group\/([^/]+)$/);
  if (!match) return null;
  const body = await readJsonBody<GroupCreateRequest>(request);
  if (!body) return jsonOk({ message: "Invalid body" }, 400);
  return updateGroup(ctx, match[1], body);
}

export async function handleGroupsDelete(ctx: AdminContext, request: Request, subpath: string) {
  const groupMatch = subpath.match(/^user\/group\/([^/]+)$/);
  if (groupMatch) {
    return deleteGroup(ctx, groupMatch[1]);
  }
  const usersMatch = subpath.match(/^user\/group\/([^/]+)\/users$/);
  if (usersMatch) {
    const body = await readJsonBody<UserGroupMapDto>(request);
    if (!body) return jsonOk({ message: "Invalid body" }, 400);
    return unmapUserFromGroup(ctx, usersMatch[1], body);
  }
  return null;
}
