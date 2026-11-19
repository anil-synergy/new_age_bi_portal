import type { AdminContext } from "./bi-admin-auth";
import {
  auditUserJson,
  getDb,
  invalidateAfterAdminWrite,
  jsonOk,
  readJsonBody,
  REPORT_PERMISSION_VIEWER,
  softDeleteRow,
} from "./bi-admin-common";
import type { ReportCreateRequest } from "./bi-admin-reports";
import {
  buildRlsForCreate,
  getRlsRolesList,
  mapEntityToRls,
  mergeRlsOnUpdate,
  removeEntityFromRls,
  selectRlsRoles,
  type RlsMapping,
} from "./bi-admin-reports";
import type { ReportDetailsDto } from "./bi-admin-reports";

const FABRIC_TYPE = "fabric-rayfin";
const GUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const URL_PATTERN = /^https?:\/\/.+/i;

type ReportMapRequest = { rolesSelected?: string[]; bypassRLS?: boolean };

export async function ensureFabricAppsTables(): Promise<void> {
  const db = getDb();
  await db.query(`
    CREATE TABLE IF NOT EXISTS bi_fabric_apps (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      app_name varchar(100) NOT NULL,
      description varchar(1000) NOT NULL DEFAULT '',
      hosting_url varchar(1000) NOT NULL,
      workspace_id uuid NOT NULL,
      app_id uuid NOT NULL,
      report_category uuid NOT NULL,
      semanticmodel_id uuid NULL,
      application_type varchar(50) NOT NULL DEFAULT 'fabric-rayfin',
      rls_enabled boolean NOT NULL DEFAULT false,
      rls_role_mapping jsonb NULL,
      created_by jsonb,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_by jsonb,
      updated_at timestamptz,
      deleted_by jsonb,
      deleted_at timestamptz,
      is_active boolean NOT NULL DEFAULT true
    )`);
  await db.query(`
    CREATE TABLE IF NOT EXISTS bi_fabric_app_role_access (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      bi_fabric_app_id uuid NOT NULL,
      role_id uuid NOT NULL,
      permission integer NOT NULL DEFAULT 1,
      "RLS_Bypassed" boolean NOT NULL DEFAULT false,
      is_active boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      created_by jsonb,
      updated_by jsonb,
      deleted_at timestamptz,
      deleted_by jsonb
    )`);
  await db.query(`
    CREATE TABLE IF NOT EXISTS bi_fabric_app_user_access (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      bi_fabric_app_id uuid NOT NULL,
      user_id uuid NOT NULL,
      email_address varchar(255),
      external_user_id uuid NOT NULL DEFAULT gen_random_uuid(),
      permission integer NOT NULL DEFAULT 1,
      "RLS_Bypassed" boolean NOT NULL DEFAULT false,
      is_active boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      created_by jsonb,
      updated_by jsonb,
      deleted_at timestamptz,
      deleted_by jsonb
    )`);
}

export async function isFabricAppId(id: string): Promise<boolean> {
  try {
    await ensureFabricAppsTables();
    const db = getDb();
    const res = await db.query<{ ok: number }>(
      `SELECT 1 AS ok FROM bi_fabric_apps WHERE id = $1 AND is_active = true LIMIT 1`,
      [id],
    );
    return Boolean(res.rows[0]);
  } catch {
    return false;
  }
}

function fabricDtoFromRow(r: {
  id: string;
  name: string;
  description: string | null;
  category_id: string;
  category_name: string | null;
  workspace_id: string;
  app_id: string;
  hosting_url: string;
  rls_enabled: boolean;
  rls_role_mapping: RlsMapping | null;
  semantic_model_id: string | null;
}): ReportDetailsDto {
  return {
    id: r.id,
    title: r.name,
    description: r.description ?? undefined,
    categoryId: r.category_id,
    categoryName: r.category_name ?? undefined,
    enablePagination: false,
    reportId: r.app_id,
    rlsEnabled: r.rls_enabled,
    workspaceId: r.workspace_id,
    powerBiReportId: r.app_id,
    powerBiRlsRole: r.rls_enabled ? getRlsRolesList(r.rls_role_mapping) : null,
    semanticModelId: r.semantic_model_id ?? "",
    favorite: false,
    applicationType: FABRIC_TYPE,
    hostingUrl: r.hosting_url,
    fabricAppId: r.app_id,
  };
}

export async function loadFabricAdminRows(ctx: AdminContext): Promise<ReportDetailsDto[]> {
  await ensureFabricAppsTables();
  const db = getDb();
  const res = await db.query<{
    id: string;
    name: string;
    description: string | null;
    category_id: string;
    category_name: string | null;
    workspace_id: string;
    app_id: string;
    hosting_url: string;
    rls_enabled: boolean;
    rls_role_mapping: RlsMapping | null;
    semantic_model_id: string | null;
  }>(
    `SELECT fa.id::text, fa.app_name AS name, fa.description, fa.report_category::text AS category_id, c.name AS category_name,
            fa.workspace_id::text, fa.app_id::text, fa.hosting_url, fa.rls_enabled, fa.rls_role_mapping,
            fa.semanticmodel_id::text AS semantic_model_id
     FROM bi_fabric_apps fa
     LEFT JOIN bi_report_categories c ON c.id = fa.report_category
     WHERE fa.is_active = true
     ORDER BY lower(fa.app_name)`,
  );
  let rows = res.rows;
  if (!ctx.isSuperAdmin && ctx.departmentCategoryIds.length) {
    const allowed = new Set(ctx.departmentCategoryIds);
    rows = rows.filter((r) => allowed.has(r.category_id));
  }
  return rows.map(fabricDtoFromRow);
}

export async function saveFabricApp(ctx: AdminContext, body: ReportCreateRequest, appId?: string) {
  await ensureFabricAppsTables();
  const name = body.name?.trim() ?? "";
  const categoryId = body.reportCategory?.trim() ?? "";
  const hostingUrl = body.hostingUrl?.trim() ?? "";
  const workspace = body.powerWorkSpaceId?.trim() ?? "";
  const rayfinAppId = body.fabricAppId?.trim() ?? "";
  if (!name || !categoryId || !hostingUrl || !workspace || !rayfinAppId) {
    return jsonOk({ message: "Missing required Fabric Rayfin fields (name, category, hosting URL, workspace, app id)" }, 400);
  }
  if (!URL_PATTERN.test(hostingUrl)) {
    return jsonOk({ message: "Hosting URL must be a valid http(s) URL" }, 400);
  }
  if (!GUID_PATTERN.test(categoryId) || !GUID_PATTERN.test(workspace) || !GUID_PATTERN.test(rayfinAppId)) {
    return jsonOk({ message: "Category, workspace ID and Rayfin app ID must be valid GUIDs" }, 400);
  }
  const semanticModelId = body.semanticModelId?.trim() ?? "";
  if (semanticModelId && !GUID_PATTERN.test(semanticModelId)) {
    return jsonOk({ message: "Semantic model ID must be a GUID when provided" }, 400);
  }
  const audit = auditUserJson(ctx.userId, ctx.userName);
  const db = getDb();
  const isUpdate = Boolean(appId);
  const id = isUpdate ? appId! : body.id && body.id !== "00000000-0000-0000-0000-000000000000" ? body.id : crypto.randomUUID();

  if (isUpdate) {
    const existing = await db.query<{ rls_role_mapping: RlsMapping | null; rls_enabled: boolean }>(
      `SELECT rls_role_mapping, rls_enabled FROM bi_fabric_apps WHERE id = $1 AND is_active = true`,
      [id],
    );
    if (!existing.rows[0]) return jsonOk({ message: "Fabric app not found" }, 404);
    let rlsJson: RlsMapping | null = existing.rows[0].rls_role_mapping;
    if (body.rlsEnabled) {
      rlsJson = mergeRlsOnUpdate(existing.rows[0].rls_role_mapping, body.powerBiRlsRole ?? []);
    } else {
      rlsJson = null;
    }
    await db.query(
      `UPDATE bi_fabric_apps
       SET app_name = $2, description = $3, report_category = $4, hosting_url = $5, workspace_id = $6, app_id = $7,
           rls_enabled = $8, rls_role_mapping = $9::jsonb, semanticmodel_id = COALESCE($11::uuid, semanticmodel_id),
           application_type = $12, updated_at = NOW(), updated_by = $10::jsonb
       WHERE id = $1`,
      [
        id,
        name,
        body.description?.trim() ?? "",
        categoryId,
        hostingUrl,
        workspace,
        rayfinAppId,
        Boolean(body.rlsEnabled),
        rlsJson ? JSON.stringify(rlsJson) : null,
        audit,
        semanticModelId || null,
        FABRIC_TYPE,
      ],
    );
  } else {
    const rlsJson = body.rlsEnabled ? buildRlsForCreate(body.powerBiRlsRole ?? []) : null;
    try {
      await db.query(
        `INSERT INTO bi_fabric_apps (id, app_name, description, hosting_url, workspace_id, app_id, report_category,
           semanticmodel_id, application_type, rls_enabled, rls_role_mapping, is_active, created_at, updated_at, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::uuid, $9, $10, $11::jsonb, true, NOW(), NOW(), $12::jsonb, $12::jsonb)`,
        [
          id,
          name,
          body.description?.trim() ?? "",
          hostingUrl,
          workspace,
          rayfinAppId,
          categoryId,
          semanticModelId || null,
          FABRIC_TYPE,
          Boolean(body.rlsEnabled),
          rlsJson ? JSON.stringify(rlsJson) : null,
          audit,
        ],
      );
    } catch (err: unknown) {
      const code = err && typeof err === "object" && "code" in err ? String((err as { code: string }).code) : "";
      if (code === "23505") return jsonOk({ message: "A Fabric app with this ID already exists" }, 409);
      if (code === "23503") return jsonOk({ message: "Department / category was not found" }, 400);
      throw err;
    }
  }
  invalidateAfterAdminWrite(ctx.email);
  const { listReportsPaged } = await import("./bi-admin-reports");
  return jsonOk(await listReportsPaged(ctx, { page: 1, pageSize: 20, search: "" }));
}

export async function deleteFabricApp(ctx: AdminContext, appId: string) {
  await ensureFabricAppsTables();
  const audit = auditUserJson(ctx.userId, ctx.userName);
  await softDeleteRow("bi_fabric_apps", appId, audit);
  invalidateAfterAdminWrite(ctx.email);
  const { listReportsPaged } = await import("./bi-admin-reports");
  return jsonOk(await listReportsPaged(ctx, { page: 1, pageSize: 20, search: "" }));
}

export async function getFabricAppAssigned(ctx: AdminContext, appId: string) {
  await ensureFabricAppsTables();
  const db = getDb();
  const base = await db.query<{
    id: string;
    name: string;
    description: string | null;
    hosting_url: string;
    workspace_id: string;
    app_id: string;
    rls_enabled: boolean;
    rls_role_mapping: RlsMapping | null;
    category_id: string;
    category_name: string | null;
    semantic_model_id: string | null;
  }>(
    `SELECT fa.id::text, fa.app_name AS name, fa.description, fa.hosting_url, fa.workspace_id::text, fa.app_id::text,
            fa.rls_enabled, fa.rls_role_mapping, fa.report_category::text AS category_id, c.name AS category_name,
            fa.semanticmodel_id::text AS semantic_model_id
     FROM bi_fabric_apps fa
     LEFT JOIN bi_report_categories c ON c.id = fa.report_category
     WHERE fa.id = $1 AND fa.is_active = true`,
    [appId],
  );
  const row = base.rows[0];
  if (!row) return jsonOk({ message: "Fabric app not found" }, 404);
  if (!ctx.isSuperAdmin && ctx.departmentCategoryIds.length && !ctx.departmentCategoryIds.includes(row.category_id)) {
    const { FORBIDDEN } = await import("./bi-admin-common");
    const { NextResponse } = await import("next/server");
    return NextResponse.json(FORBIDDEN, { status: 403 });
  }

  const groups = await db.query<{
    group_name: string;
    group_id: string;
    mapping_id: string;
    permission: number;
    rls_bypassed: boolean;
  }>(
    `SELECT g.name AS group_name, g.id::text AS group_id, ra.id::text AS mapping_id, ra.permission, ra."RLS_Bypassed" AS rls_bypassed
     FROM bi_fabric_app_role_access ra
     JOIN role g ON g.id = ra.role_id
     WHERE ra.bi_fabric_app_id = $1 AND ra.is_active = true`,
    [appId],
  );

  const users = await db.query<{
    user_name: string;
    user_email: string;
    user_id: string;
    mapping_id: string;
    permission: number;
    rls_bypassed: boolean;
  }>(
    `SELECT u.name AS user_name, u.email_address AS user_email, u.id::text AS user_id, ua.id::text AS mapping_id,
            ua.permission, ua."RLS_Bypassed" AS rls_bypassed
     FROM bi_fabric_app_user_access ua
     JOIN users u ON u.id = ua.user_id
     WHERE ua.bi_fabric_app_id = $1 AND ua.is_active = true`,
    [appId],
  );

  return jsonOk({
    id: row.id,
    title: row.name,
    description: row.description ?? undefined,
    enablePagination: false,
    applicationType: FABRIC_TYPE,
    hostingUrl: row.hosting_url,
    fabricAppId: row.app_id,
    powerBiReportId: row.app_id,
    semanticModelId: row.semantic_model_id ?? "",
    workspaceId: row.workspace_id,
    rlsEnabled: row.rls_enabled,
    powerBiRlsRole: getRlsRolesList(row.rls_role_mapping),
    reportCategory: { id: row.category_id, name: row.category_name ?? undefined },
    assignedGroup: groups.rows.map((g) => ({
      group: g.group_name,
      groupId: g.group_id,
      mappingGroupId: g.mapping_id,
      permission: g.permission,
      RLS_Bypassed: g.rls_bypassed,
      rlsRoleAssigned: selectRlsRoles(row.rls_role_mapping, g.group_id, false),
    })),
    assignedUsers: users.rows.map((u) => ({
      user: u.user_name,
      userEmail: u.user_email,
      userId: u.user_id,
      mappingUserId: u.mapping_id,
      permission: u.permission,
      RLS_Bypassed: u.rls_bypassed,
      rlsRoleAssigned: selectRlsRoles(row.rls_role_mapping, u.user_id, true),
    })),
  });
}

async function upsertFabricGroupAccess(appId: string, groupId: string, req: ReportMapRequest, audit: string) {
  const db = getDb();
  const existing = await db.query<{ id: string }>(
    `SELECT id::text FROM bi_fabric_app_role_access WHERE bi_fabric_app_id = $1 AND role_id = $2 AND is_active = true`,
    [appId, groupId],
  );
  if (existing.rows[0]) {
    await db.query(
      `UPDATE bi_fabric_app_role_access SET "RLS_Bypassed" = $2, updated_at = NOW(), updated_by = $3::jsonb WHERE id = $1`,
      [existing.rows[0].id, Boolean(req.bypassRLS), audit],
    );
    return;
  }
  await db.query(
    `INSERT INTO bi_fabric_app_role_access (id, bi_fabric_app_id, role_id, permission, "RLS_Bypassed", is_active, created_at, updated_at, created_by, updated_by)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, true, NOW(), NOW(), $5::jsonb, $5::jsonb)`,
    [appId, groupId, REPORT_PERMISSION_VIEWER, Boolean(req.bypassRLS), audit],
  );
}

async function upsertFabricUserAccess(appId: string, userId: string, req: ReportMapRequest, audit: string) {
  const db = getDb();
  const user = await db.query<{ email_address: string }>(`SELECT email_address FROM users WHERE id = $1`, [userId]);
  const email = user.rows[0]?.email_address ?? "";
  const existing = await db.query<{ id: string }>(
    `SELECT id::text FROM bi_fabric_app_user_access WHERE bi_fabric_app_id = $1 AND user_id = $2 AND is_active = true`,
    [appId, userId],
  );
  if (existing.rows[0]) {
    await db.query(
      `UPDATE bi_fabric_app_user_access SET "RLS_Bypassed" = $2, updated_at = NOW(), updated_by = $3::jsonb WHERE id = $1`,
      [existing.rows[0].id, Boolean(req.bypassRLS), audit],
    );
    return;
  }
  await db.query(
    `INSERT INTO bi_fabric_app_user_access (id, bi_fabric_app_id, user_id, email_address, external_user_id, permission, "RLS_Bypassed", is_active, created_at, updated_at, created_by, updated_by)
     VALUES (gen_random_uuid(), $1, $2, $3, gen_random_uuid(), $4, $5, true, NOW(), NOW(), $6::jsonb, $6::jsonb)`,
    [appId, userId, email, REPORT_PERMISSION_VIEWER, Boolean(req.bypassRLS), audit],
  );
}

export async function mapFabricAppGroup(ctx: AdminContext, appId: string, groupId: string, request: Request) {
  const body = (await readJsonBody<ReportMapRequest>(request)) ?? {};
  const roles = body.rolesSelected ?? [];
  const audit = auditUserJson(ctx.userId, ctx.userName);
  const db = getDb();
  const app = await db.query<{ rls_enabled: boolean; rls_role_mapping: RlsMapping | null }>(
    `SELECT rls_enabled, rls_role_mapping FROM bi_fabric_apps WHERE id = $1 AND is_active = true`,
    [appId],
  );
  if (!app.rows[0]) return jsonOk({ message: "Fabric app not found" }, 404);
  await upsertFabricGroupAccess(appId, groupId, body, audit);
  if (app.rows[0].rls_enabled && roles.length) {
    const next = mapEntityToRls(app.rows[0].rls_role_mapping, groupId, roles, false);
    await db.query(`UPDATE bi_fabric_apps SET rls_role_mapping = $2::jsonb, updated_at = NOW(), updated_by = $3::jsonb WHERE id = $1`, [
      appId,
      JSON.stringify(next),
      audit,
    ]);
  }
  invalidateAfterAdminWrite(ctx.email);
  return getFabricAppAssigned(ctx, appId);
}

export async function mapFabricAppUser(ctx: AdminContext, appId: string, userId: string, request: Request) {
  const body = (await readJsonBody<ReportMapRequest>(request)) ?? {};
  const roles = body.rolesSelected ?? [];
  const audit = auditUserJson(ctx.userId, ctx.userName);
  const db = getDb();
  const app = await db.query<{ rls_enabled: boolean; rls_role_mapping: RlsMapping | null }>(
    `SELECT rls_enabled, rls_role_mapping FROM bi_fabric_apps WHERE id = $1 AND is_active = true`,
    [appId],
  );
  if (!app.rows[0]) return jsonOk({ message: "Fabric app not found" }, 404);
  await upsertFabricUserAccess(appId, userId, body, audit);
  if (app.rows[0].rls_enabled && roles.length) {
    const next = mapEntityToRls(app.rows[0].rls_role_mapping, userId, roles, true);
    await db.query(`UPDATE bi_fabric_apps SET rls_role_mapping = $2::jsonb, updated_at = NOW(), updated_by = $3::jsonb WHERE id = $1`, [
      appId,
      JSON.stringify(next),
      audit,
    ]);
  }
  invalidateAfterAdminWrite(ctx.email);
  return getFabricAppAssigned(ctx, appId);
}

export async function unmapFabricAppGroup(ctx: AdminContext, body: { reportId: string; mappingGroupId: string }) {
  const audit = auditUserJson(ctx.userId, ctx.userName);
  const db = getDb();
  const mapped = await db.query<{ role_id: string }>(
    `SELECT role_id::text FROM bi_fabric_app_role_access WHERE id = $1 AND bi_fabric_app_id = $2 AND is_active = true`,
    [body.mappingGroupId, body.reportId],
  );
  const groupId = mapped.rows[0]?.role_id;
  await softDeleteRow("bi_fabric_app_role_access", body.mappingGroupId, audit);
  if (groupId) {
    const app = await db.query<{ rls_enabled: boolean; rls_role_mapping: RlsMapping | null }>(
      `SELECT rls_enabled, rls_role_mapping FROM bi_fabric_apps WHERE id = $1`,
      [body.reportId],
    );
    if (app.rows[0]?.rls_enabled) {
      const next = removeEntityFromRls(app.rows[0].rls_role_mapping, groupId, false);
      await db.query(`UPDATE bi_fabric_apps SET rls_role_mapping = $2::jsonb WHERE id = $1`, [body.reportId, JSON.stringify(next)]);
    }
  }
  invalidateAfterAdminWrite(ctx.email);
  return getFabricAppAssigned(ctx, body.reportId);
}

export async function unmapFabricAppUser(ctx: AdminContext, body: { reportId: string; mappingUserId: string }) {
  const audit = auditUserJson(ctx.userId, ctx.userName);
  const db = getDb();
  const mapped = await db.query<{ user_id: string }>(
    `SELECT user_id::text FROM bi_fabric_app_user_access WHERE id = $1 AND bi_fabric_app_id = $2 AND is_active = true`,
    [body.mappingUserId, body.reportId],
  );
  const userId = mapped.rows[0]?.user_id;
  await softDeleteRow("bi_fabric_app_user_access", body.mappingUserId, audit);
  if (userId) {
    const app = await db.query<{ rls_enabled: boolean; rls_role_mapping: RlsMapping | null }>(
      `SELECT rls_enabled, rls_role_mapping FROM bi_fabric_apps WHERE id = $1`,
      [body.reportId],
    );
    if (app.rows[0]?.rls_enabled) {
      const next = removeEntityFromRls(app.rows[0].rls_role_mapping, userId, true);
      await db.query(`UPDATE bi_fabric_apps SET rls_role_mapping = $2::jsonb WHERE id = $1`, [body.reportId, JSON.stringify(next)]);
    }
  }
  invalidateAfterAdminWrite(ctx.email);
  return getFabricAppAssigned(ctx, body.reportId);
}