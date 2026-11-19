import { NextResponse } from "next/server";
import type { AdminContext } from "./bi-admin-auth";
import {
  auditUserJson,
  EMPTY_GUID,
  FORBIDDEN,
  getDb,
  invalidateAfterAdminWrite,
  jsonOk,
  matchesSearch,
  normalizePaged,
  readJsonBody,
  softDeleteRow,
  SYSTEM_ADMIN,
  type PageModel,
  type PagedRequest,
} from "./bi-admin-common";

type GroupDto = { id: string; name: string };
type UserDetailDto = {
  id: string;
  name: string;
  email: string;
  group: GroupDto[];
  reports: unknown[];
  createdBy?: string;
  createdAt?: string;
  updatedBy?: string;
  updatedAt?: string;
};

type UserCreateRequest = {
  id?: string;
  name?: string;
  emailAddress?: string;
  group?: string[];
  sendMail?: boolean;
};

const DEFAULT_LIST: PagedRequest = { page: 1, pageSize: 20, search: "" };

async function loadGroupsForUsers(userIds: string[]): Promise<Map<string, GroupDto[]>> {
  const map = new Map<string, GroupDto[]>();
  if (!userIds.length) return map;
  const db = getDb();
  const res = await db.query<{ user_id: string; id: string; name: string }>(
    `SELECT ur.user_id::text, r.id::text, r.name
     FROM user_roles ur
     JOIN role r ON r.id = ur.role_id
     WHERE ur.is_active = true AND r.is_active = true AND ur.user_id = ANY($1::uuid[])`,
    [userIds],
  );
  for (const row of res.rows) {
    const list = map.get(row.user_id) ?? [];
    list.push({ id: row.id, name: row.name });
    map.set(row.user_id, list);
  }
  return map;
}

function rowToDto(
  row: { id: string; name: string; email_address: string; created_by: unknown; created_at: Date; updated_by: unknown; updated_at: Date },
  groups: GroupDto[],
): UserDetailDto {
  const createdBy =
    row.created_by && typeof row.created_by === "object" && "Name" in (row.created_by as object)
      ? String((row.created_by as { Name?: string }).Name ?? "")
      : undefined;
  const updatedBy =
    row.updated_by && typeof row.updated_by === "object" && "Name" in (row.updated_by as object)
      ? String((row.updated_by as { Name?: string }).Name ?? "")
      : undefined;
  return {
    id: row.id,
    name: row.name,
    email: row.email_address,
    group: groups,
    reports: [],
    createdBy,
    createdAt: row.created_at?.toISOString?.() ?? String(row.created_at),
    updatedBy,
    updatedAt: row.updated_at?.toISOString?.() ?? String(row.updated_at),
  };
}

export async function listUsersPaged(paged: PagedRequest): Promise<PageModel<UserDetailDto>> {
  const { page, pageSize, search } = normalizePaged(paged);
  const db = getDb();
  const pattern = search ? `%${search}%` : null;
  const countRes = await db.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM users
     WHERE is_active = true
       AND ($1::text IS NULL OR lower(name) LIKE lower($1) OR lower(email_address) LIKE lower($1))`,
    [pattern],
  );
  const totalItems = Number(countRes.rows[0]?.n ?? 0);
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const offset = (safePage - 1) * pageSize;
  const res = await db.query<{
    id: string;
    name: string;
    email_address: string;
    created_by: unknown;
    created_at: Date;
    updated_by: unknown;
    updated_at: Date;
  }>(
    `SELECT id::text, name, email_address, created_by, created_at, updated_by, updated_at
     FROM users
     WHERE is_active = true
       AND ($1::text IS NULL OR lower(name) LIKE lower($1) OR lower(email_address) LIKE lower($1))
     ORDER BY lower(name), lower(email_address)
     LIMIT $2 OFFSET $3`,
    [pattern, pageSize, offset],
  );
  const groupMap = await loadGroupsForUsers(res.rows.map((u) => u.id));
  return {
    currentPage: safePage,
    totalItems,
    totalPages,
    totalCount: totalItems,
    pageSize,
    items: res.rows.map((u) => rowToDto(u, groupMap.get(u.id) ?? [])),
    hasNext: safePage < totalPages,
    hasPrev: safePage > 1,
  };
}

export async function listAllUsers(): Promise<UserDetailDto[]> {
  const db = getDb();
  const res = await db.query<{ id: string; name: string; email_address: string; created_at: Date; updated_at: Date; created_by: unknown; updated_by: unknown }>(
    `SELECT id::text, name, email_address, created_by, created_at, updated_by, updated_at
     FROM users WHERE is_active = true ORDER BY lower(name)`,
  );
  const groupMap = await loadGroupsForUsers(res.rows.map((u) => u.id));
  return res.rows.map((u) => rowToDto(u, groupMap.get(u.id) ?? []));
}

export async function listUserEmails(ctx: AdminContext) {
  const all = await listAllUsers();
  return all.map((user) => {
    const roleNames = user.group.map((g) => g.name);
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      group: user.group,
      isSuperAdmin: roleNames.includes(SYSTEM_ADMIN),
      isDepartmentAdmin: ctx.isDepAdmin && !roleNames.includes(SYSTEM_ADMIN),
    };
  });
}

async function emailTaken(email: string, exceptId: string): Promise<boolean> {
  const db = getDb();
  const res = await db.query<{ id: string }>(
    `SELECT id::text FROM users
     WHERE is_active = true AND lower(trim(email_address)) = lower(trim($1)) AND id <> $2
     LIMIT 1`,
    [email, exceptId || EMPTY_GUID],
  );
  return res.rows.length > 0;
}

async function resolveGroupIds(namesOrIds: string[]): Promise<string[]> {
  if (!namesOrIds.length) return [];
  const db = getDb();
  const ids: string[] = [];
  for (const raw of namesOrIds) {
    const value = raw.trim();
    if (!value) continue;
    const byId = await db.query<{ id: string }>(`SELECT id::text FROM role WHERE is_active = true AND id = $1`, [value]);
    if (byId.rows[0]) {
      ids.push(byId.rows[0].id);
      continue;
    }
    const byName = await db.query<{ id: string }>(
      `SELECT id::text FROM role WHERE is_active = true AND lower(trim(name)) = lower(trim($1)) LIMIT 1`,
      [value],
    );
    if (byName.rows[0]) ids.push(byName.rows[0].id);
  }
  return [...new Set(ids)];
}

export async function addUser(ctx: AdminContext, body: UserCreateRequest) {
  const name = body.name?.trim() ?? "";
  const email = body.emailAddress?.trim() ?? "";
  const userId = body.id?.trim() || crypto.randomUUID();
  if (!name || !email) {
    return jsonOk({ message: "Name and email are required" }, 400);
  }
  if (await emailTaken(email, userId)) {
    return jsonOk({ message: "User already exists" }, 422);
  }
  const audit = auditUserJson(ctx.userId, ctx.userName);
  const groupIds = body.group ?? [];
  const db = getDb();
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO users (id, name, email_address, external_user_id, issuer, send_mail, is_active, created_at, updated_at, created_by, updated_by)
       VALUES ($1, $2, lower(trim($3)), gen_random_uuid(), '', $4, true, NOW(), NOW(), $5::jsonb, $5::jsonb)`,
      [userId, name, email, Boolean(body.sendMail), audit],
    );
    for (const roleId of groupIds) {
      await client.query(
        `INSERT INTO user_roles (id, user_id, role_id, is_active, created_at, updated_at, created_by, updated_by)
         VALUES (gen_random_uuid(), $1, $2, true, NOW(), NOW(), $3::jsonb, $3::jsonb)`,
        [userId, roleId, audit],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  invalidateAfterAdminWrite(ctx.email);
  return jsonOk(await listUsersPaged(DEFAULT_LIST));
}

export async function updateUser(ctx: AdminContext, userId: string, body: UserCreateRequest) {
  const name = body.name?.trim() ?? "";
  const email = body.emailAddress?.trim() ?? "";
  if (!name || !email) {
    return jsonOk({ message: "Name and email are required" }, 400);
  }
  if (await emailTaken(email, userId)) {
    return jsonOk({ message: "User already exists" }, 422);
  }
  const audit = auditUserJson(ctx.userId, ctx.userName);
  const selected = body.group ?? [];
  const db = getDb();
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const existing = await client.query<{ email_address: string }>(
      `SELECT email_address FROM users WHERE id = $1 AND is_active = true`,
      [userId],
    );
    if (!existing.rows[0]) {
      await client.query("ROLLBACK");
      return jsonOk({ message: "User not found" }, 404);
    }
    await client.query(
      `UPDATE users SET name = $2, email_address = lower(trim($3)), updated_at = NOW(), updated_by = $4::jsonb WHERE id = $1`,
      [userId, name, email, audit],
    );
    const prev = await client.query<{ role_id: string; id: string }>(
      `SELECT id::text, role_id::text FROM user_roles WHERE user_id = $1 AND is_active = true`,
      [userId],
    );
    const prevRoleIds = prev.rows.map((r) => r.role_id);
    const toRemove = prev.rows.filter((r) => !selected.includes(r.role_id));
    if (toRemove.length) {
      const removingAdmin = await client.query<{ name: string }>(
        `SELECT name FROM role WHERE id = ANY($1::uuid[]) AND name = $2`,
        [toRemove.map((r) => r.role_id), SYSTEM_ADMIN],
      );
      if (
        removingAdmin.rows.length &&
        existing.rows[0].email_address.toLowerCase() === ctx.email.toLowerCase()
      ) {
        await client.query("ROLLBACK");
        return jsonOk({ message: "Cannot remove your own System Admin role" }, 422);
      }
      for (const row of toRemove) {
        await client.query(
          `UPDATE user_roles SET is_active = false, deleted_at = NOW(), deleted_by = $2::jsonb, updated_at = NOW(), updated_by = $2::jsonb WHERE id = $1`,
          [row.id, audit],
        );
      }
    }
    const toAdd = selected.filter((id) => !prevRoleIds.includes(id));
    for (const roleId of toAdd) {
      await client.query(
        `INSERT INTO user_roles (id, user_id, role_id, is_active, created_at, updated_at, created_by, updated_by)
         VALUES (gen_random_uuid(), $1, $2, true, NOW(), NOW(), $3::jsonb, $3::jsonb)`,
        [userId, roleId, audit],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  invalidateAfterAdminWrite(ctx.email);
  return jsonOk(await listUsersPaged(DEFAULT_LIST));
}

export async function getUserById(ctx: AdminContext, userId: string) {
  if (!ctx.isSuperAdmin) {
    return NextResponse.json(FORBIDDEN, { status: 403 });
  }
  const db = getDb();
  const res = await db.query<{
    id: string;
    name: string;
    email_address: string;
    created_by: unknown;
    created_at: Date;
    updated_by: unknown;
    updated_at: Date;
  }>(
    `SELECT id::text, name, email_address, created_by, created_at, updated_by, updated_at
     FROM users WHERE id = $1 AND is_active = true`,
    [userId],
  );
  const row = res.rows[0];
  if (!row) return jsonOk({ message: "User not found" }, 404);
  const groupMap = await loadGroupsForUsers([userId]);
  return jsonOk(rowToDto(row, groupMap.get(userId) ?? []));
}

export async function deleteUser(ctx: AdminContext, userId: string) {
  if (!ctx.isSuperAdmin) {
    return NextResponse.json(FORBIDDEN, { status: 403 });
  }
  const audit = auditUserJson(ctx.userId, ctx.userName);
  await softDeleteRow("users", userId, audit);
  invalidateAfterAdminWrite(ctx.email);
  return jsonOk(await listUsersPaged(DEFAULT_LIST));
}

export async function bulkImportUsers(ctx: AdminContext, request: Request) {
  const body = await readJsonBody<{ users?: { email?: string; fullName?: string; groups?: string; valid?: boolean }[] }>(
    request,
  );
  const rows = (body?.users ?? []).filter((r) => r.valid !== false && r.email && r.fullName);
  let success = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      const groupNames = (row.groups ?? "")
        .split(/[,;]/)
        .map((s) => s.trim())
        .filter(Boolean);
      const groupIds = groupNames.length ? await resolveGroupIds(groupNames) : [];
      const result = await addUser(ctx, {
        id: crypto.randomUUID(),
        name: row.fullName!.trim(),
        emailAddress: row.email!.trim(),
        group: groupIds,
        sendMail: false,
      });
      if (result.status >= 400) failed += 1;
      else success += 1;
    } catch {
      failed += 1;
    }
  }
  invalidateAfterAdminWrite(ctx.email);
  return jsonOk({ success, failed });
}

export async function handleUsersPost(ctx: AdminContext, request: Request, subpath: string) {
  if (subpath === "users") {
    const body = await readJsonBody<PagedRequest>(request);
    return jsonOk(await listUsersPaged(body ?? DEFAULT_LIST));
  }
  if (subpath === "users/bulk") {
    return bulkImportUsers(ctx, request);
  }
  if (subpath === "user") {
    const body = await readJsonBody<UserCreateRequest>(request);
    if (!body) return jsonOk({ message: "Invalid body" }, 400);
    return addUser(ctx, body);
  }
  return null;
}

const USER_GET_RESERVED = new Set(["group"]);

export async function handleUsersGet(ctx: AdminContext, subpath: string) {
  if (subpath === "users/email") {
    return jsonOk(await listUserEmails(ctx));
  }
  if (subpath === "allUsers") {
    return jsonOk(await listAllUsers());
  }
  const match = subpath.match(/^user\/([^/]+)$/);
  if (match) {
    const segment = match[1];
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(segment);
    if (USER_GET_RESERVED.has(segment) || !isUuid) return null;
    return getUserById(ctx, segment);
  }
  return null;
}

export async function handleUsersPut(ctx: AdminContext, subpath: string, request: Request) {
  const match = subpath.match(/^user\/([^/]+)$/);
  if (!match || USER_GET_RESERVED.has(match[1])) return null;
  if (!ctx.isSuperAdmin) {
    return NextResponse.json(FORBIDDEN, { status: 403 });
  }
  const body = await readJsonBody<UserCreateRequest>(request);
  if (!body) return jsonOk({ message: "Invalid body" }, 400);
  body.id = match[1];
  return updateUser(ctx, match[1], body);
}

export async function handleUsersDelete(ctx: AdminContext, subpath: string) {
  const match = subpath.match(/^user\/([^/]+)$/);
  if (!match || USER_GET_RESERVED.has(match[1])) return null;
  return deleteUser(ctx, match[1]);
}
