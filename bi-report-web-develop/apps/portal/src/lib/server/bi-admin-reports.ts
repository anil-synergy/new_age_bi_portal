import type { AdminContext } from "./bi-admin-auth";
import {
  auditUserJson,
  EMPTY_GUID,
  getDb,
  invalidateAfterAdminWrite,
  jsonOk,
  matchesSearch,
  normalizePaged,
  readJsonBody,
  REPORT_PERMISSION_VIEWER,
  softDeleteRow,
  type PageModel,
  type PagedRequest,
} from "./bi-admin-common";

type RlsRoleDto = { id?: string; rlsRole?: string };
export type ReportDetailsDto = {
  /** bi_report.semanticmodel_id; empty when the report has no semantic model stored. */
  semanticModelId?: string;
  id: string;
  title: string;
  description?: string;
  categoryId: string;
  categoryName?: string;
  enablePagination: boolean;
  reportId: string;
  rlsEnabled: boolean;
  workspaceId: string;
  powerBiReportId: string;
  powerBiRlsRole?: RlsRoleDto[] | null;
  favorite?: boolean;
  applicationType?: string;
  hostingUrl?: string;
  fabricAppId?: string;
};

type ReportCreateRequest = {
  id?: string;
  name?: string;
  description?: string;
  reportCategory?: string;
  powerBiReportId?: string;
  powerWorkSpaceId?: string;
  rlsEnabled?: boolean;
  enablePagination?: boolean;
  powerBiRlsRole?: RlsRoleDto[];
  /** Power BI semantic model (dataset) id. Required when adding a report. */
  semanticModelId?: string;
  /** Value of the "Application type" dropdown, stored in bi_report.application_type. */
  applicationType?: string;
  /** Fabric Rayfin: iframe URL (bi_fabric_apps.hosting_url). */
  hostingUrl?: string;
  /** Fabric Rayfin: item id (bi_fabric_apps.app_id). */
  fabricAppId?: string;
};

const DEFAULT_APPLICATION_TYPE = "power-bi";
const GUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type RlsMapping = {
  RoleMappings?: Array<{
    Id?: string;
    id?: string;
    RlsRole?: string;
    rlsRole?: string;
    Groups?: string[];
    groups?: string[];
    Users?: string[];
    users?: string[];
    IsActive?: boolean;
    isActive?: boolean;
  }>;
  roleMappings?: RlsMapping["RoleMappings"];
};

const DEFAULT_LIST: PagedRequest = { page: 1, pageSize: 20, search: "" };

function roleMappings(raw: RlsMapping | null) {
  return raw?.RoleMappings ?? raw?.roleMappings ?? [];
}

export function getRlsRolesList(raw: RlsMapping | null): RlsRoleDto[] {
  return roleMappings(raw)
    .filter((m) => (m.IsActive ?? m.isActive) !== false)
    .map((m) => ({
      id: String(m.Id ?? m.id ?? EMPTY_GUID),
      rlsRole: String(m.RlsRole ?? m.rlsRole ?? ""),
    }))
    .filter((m) => m.rlsRole);
}

export function selectRlsRoles(raw: RlsMapping | null, entityId: string, isUser: boolean): string[] {
  const key = entityId.toLowerCase();
  const names: string[] = [];
  for (const m of roleMappings(raw)) {
    if ((m.IsActive ?? m.isActive) === false) continue;
    const role = m.RlsRole ?? m.rlsRole;
    if (!role) continue;
    const list = isUser ? (m.Users ?? m.users ?? []) : (m.Groups ?? m.groups ?? []);
    if (list.some((id) => id.toLowerCase() === key)) names.push(role);
  }
  return names;
}

function cloneRls(raw: RlsMapping | null): RlsMapping {
  return JSON.parse(JSON.stringify(raw ?? { RoleMappings: [] })) as RlsMapping;
}

export function mapEntityToRls(existing: RlsMapping | null, entityId: string, roles: string[], isUser: boolean): RlsMapping {
  const data = cloneRls(existing);
  let mappings = roleMappings(data);
  if (!mappings.length) {
    mappings = [{ Groups: [], Users: [], IsActive: true }];
    data.RoleMappings = mappings;
  }
  for (const roleName of roles) {
    let entry = mappings.find((m) => (m.RlsRole ?? m.rlsRole) === roleName);
    if (!entry) {
      entry = {
        Id: crypto.randomUUID(),
        RlsRole: roleName,
        Groups: [],
        Users: [],
        IsActive: true,
      };
      mappings.push(entry);
    }
    const list = isUser ? (entry.Users ?? (entry.Users = [])) : (entry.Groups ?? (entry.Groups = []));
    const idStr = entityId.toString();
    if (!list.includes(idStr)) list.push(idStr);
  }
  return data;
}

export function removeEntityFromRls(existing: RlsMapping | null, entityId: string, isUser: boolean): RlsMapping {
  const data = cloneRls(existing);
  const idStr = entityId.toString();
  for (const m of roleMappings(data)) {
    const list = isUser ? m.Users ?? m.users : m.Groups ?? m.groups;
    if (!list) continue;
    const idx = list.indexOf(idStr);
    if (idx >= 0) list.splice(idx, 1);
  }
  return data;
}

export function buildRlsForCreate(roles: RlsRoleDto[]): RlsMapping | null {
  const active = roles.filter((r) => r.rlsRole?.trim());
  if (!active.length) return null;
  return {
    RoleMappings: active.map((r) => ({
      Id: r.id && r.id !== EMPTY_GUID ? r.id : crypto.randomUUID(),
      RlsRole: r.rlsRole!.trim(),
      Groups: [],
      Users: [],
      IsActive: true,
    })),
  };
}

export function mergeRlsOnUpdate(existing: RlsMapping | null, incoming: RlsRoleDto[]): RlsMapping | null {
  const mapped = cloneRls(existing);
  let mappings = roleMappings(mapped);
  if (!mappings.length) mappings = [];
  const incomingIds = new Set(incoming.filter((r) => r.id && r.id !== EMPTY_GUID).map((r) => r.id!.toLowerCase()));
  for (const m of mappings) {
    const id = String(m.Id ?? m.id ?? "").toLowerCase();
    if (id && !incomingIds.has(id)) {
      m.IsActive = false;
      m.isActive = false;
    }
  }
  for (const role of incoming) {
    const name = role.rlsRole?.trim();
    if (!name) continue;
    if (role.id && role.id !== EMPTY_GUID) {
      const found = mappings.find((m) => String(m.Id ?? m.id).toLowerCase() === role.id!.toLowerCase());
      if (found) {
        found.RlsRole = name;
        found.rlsRole = name;
        found.IsActive = true;
        found.isActive = true;
        continue;
      }
    }
    mappings.push({
      Id: crypto.randomUUID(),
      RlsRole: name,
      Groups: [],
      Users: [],
      IsActive: true,
    });
  }
  mapped.RoleMappings = mappings;
  return mapped;
}

async function loadReportRows(ctx: AdminContext): Promise<ReportDetailsDto[]> {
  const db = getDb();
  const res = await db.query<{
    id: string;
    name: string;
    description: string | null;
    category_id: string;
    category_name: string | null;
    enable_pagination: boolean;
    powerbi_report_id: string;
    powerbi_workspace_id: string;
    rls_enabled: boolean;
    rls_role_mapping: RlsMapping | null;
    semantic_model_id: string | null;
  }>(
    `SELECT br.id::text, br.name, br.description, br.report_category::text AS category_id, c.name AS category_name,
            br.enable_pagination, br.powerbi_report_id::text, br.powerbi_workspace_id::text, br.rls_enabled, br.rls_role_mapping,
            br.semanticmodel_id::text AS semantic_model_id
     FROM bi_report br
     LEFT JOIN bi_report_categories c ON c.id = br.report_category
     WHERE br.is_active = true
     ORDER BY lower(br.name)`,
  );
  let rows = res.rows;
  if (!ctx.isSuperAdmin && ctx.departmentCategoryIds.length) {
    const allowed = new Set(ctx.departmentCategoryIds);
    rows = rows.filter((r) => allowed.has(r.category_id));
  }
  return rows.map((r) => ({
    id: r.id,
    title: r.name,
    description: r.description ?? undefined,
    categoryId: r.category_id,
    categoryName: r.category_name ?? undefined,
    enablePagination: r.enable_pagination,
    reportId: r.powerbi_report_id,
    rlsEnabled: r.rls_enabled,
    workspaceId: r.powerbi_workspace_id,
    powerBiReportId: r.powerbi_report_id,
    powerBiRlsRole: r.rls_enabled ? getRlsRolesList(r.rls_role_mapping) : null,
    semanticModelId: r.semantic_model_id ?? "",
    favorite: false,
  }));
}

export async function listReportsPaged(ctx: AdminContext, paged: PagedRequest): Promise<PageModel<ReportDetailsDto>> {
  const { page, pageSize, search, filterValue } = normalizePaged(paged);
  const { loadFabricAdminRows } = await import("./bi-admin-fabric-apps");
  const powerBiItems: ReportDetailsDto[] = (await loadReportRows(ctx)).map((r) => ({
    ...r,
    applicationType: "power-bi",
  }));
  let fabricItems: ReportDetailsDto[] = [];
  try {
    fabricItems = await loadFabricAdminRows(ctx);
  } catch {
    fabricItems = [];
  }
  const needle = search.trim().toLowerCase();
  let merged = [...powerBiItems, ...fabricItems].filter((row) => {
    if (filterValue && row.categoryId !== filterValue) return false;
    if (needle && !row.title.toLowerCase().includes(needle)) return false;
    return true;
  });
  merged.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" }));
  const totalItems = merged.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const offset = (safePage - 1) * pageSize;
  const items = merged.slice(offset, offset + pageSize);
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

export async function getReportAssigned(ctx: AdminContext, reportId: string) {
  const { getFabricAppAssigned, isFabricAppId } = await import("./bi-admin-fabric-apps");
  if (await isFabricAppId(reportId)) {
    return getFabricAppAssigned(ctx, reportId);
  }
  const db = getDb();
  const base = await db.query<{
    id: string;
    name: string;
    description: string | null;
    enable_pagination: boolean;
    powerbi_report_id: string;
    powerbi_workspace_id: string;
    rls_enabled: boolean;
    rls_role_mapping: RlsMapping | null;
    category_id: string;
    category_name: string | null;
    semantic_model_id: string | null;
  }>(
    `SELECT br.id::text, br.name, br.description, br.enable_pagination, br.powerbi_report_id::text, br.powerbi_workspace_id::text,
            br.rls_enabled, br.rls_role_mapping, br.report_category::text AS category_id, c.name AS category_name,
            br.semanticmodel_id::text AS semantic_model_id
     FROM bi_report br
     LEFT JOIN bi_report_categories c ON c.id = br.report_category
     WHERE br.id = $1 AND br.is_active = true`,
    [reportId],
  );
  const row = base.rows[0];
  if (!row) return jsonOk({ message: "Report not found" }, 404);
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
    `SELECT g.name AS group_name, g.id::text AS group_id, ra.id::text AS mapping_id, ra."permission" AS permission, ra."RLS_Bypassed" AS rls_bypassed
     FROM bi_report_role_access ra
     JOIN role g ON g.id = ra.role_id
     WHERE ra.bi_report_id = $1 AND ra.is_active = true`,
    [reportId],
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
            ua."permission" AS permission, ua."RLS_Bypassed" AS rls_bypassed
     FROM bi_report_user_access ua
     JOIN users u ON u.id = ua.user_id
     WHERE ua.bi_report_id = $1 AND ua.is_active = true`,
    [reportId],
  );

  return jsonOk({
    id: row.id,
    title: row.name,
    description: row.description ?? undefined,
    enablePagination: row.enable_pagination,
    powerBiReportId: row.powerbi_report_id,
    semanticModelId: row.semantic_model_id ?? "",
    workspaceId: row.powerbi_workspace_id,
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

export async function saveReport(ctx: AdminContext, body: ReportCreateRequest, reportId?: string) {
  const applicationType = body.applicationType?.trim() || DEFAULT_APPLICATION_TYPE;
  if (applicationType === "fabric-rayfin") {
    const { saveFabricApp } = await import("./bi-admin-fabric-apps");
    return saveFabricApp(ctx, body, reportId);
  }
  const name = body.name?.trim() ?? "";
  const categoryId = body.reportCategory?.trim() ?? "";
  const pbiReport = body.powerBiReportId?.trim() ?? "";
  const workspace = body.powerWorkSpaceId?.trim() ?? "";
  if (!name || !categoryId || !pbiReport || !workspace) {
    return jsonOk({ message: "Missing required report fields" }, 400);
  }
  const semanticModelId = body.semanticModelId?.trim() ?? "";
  // Mandatory on add; on edit an empty value keeps the stored semantic model.
  if (!reportId && !GUID_PATTERN.test(semanticModelId)) {
    return jsonOk({ message: "Semantic model ID is required and must be a GUID" }, 400);
  }
  if (semanticModelId && !GUID_PATTERN.test(semanticModelId)) {
    return jsonOk({ message: "Semantic model ID must be a GUID" }, 400);
  }
  const audit = auditUserJson(ctx.userId, ctx.userName);
  const db = getDb();
  const isUpdate = Boolean(reportId);
  const id = isUpdate
    ? reportId!
    : body.id && body.id !== EMPTY_GUID
      ? body.id
      : crypto.randomUUID();

  if (isUpdate) {
    const existing = await db.query<{ rls_role_mapping: RlsMapping | null; rls_enabled: boolean }>(
      `SELECT rls_role_mapping, rls_enabled FROM bi_report WHERE id = $1 AND is_active = true`,
      [id],
    );
    if (!existing.rows[0]) return jsonOk({ message: "Report not found" }, 404);
    let rlsJson: RlsMapping | null = existing.rows[0].rls_role_mapping;
    if (body.rlsEnabled) {
      rlsJson = mergeRlsOnUpdate(existing.rows[0].rls_role_mapping, body.powerBiRlsRole ?? []);
    } else {
      rlsJson = null;
    }
    await db.query(
      `UPDATE bi_report
       SET name = $2, description = $3, report_category = $4, powerbi_report_id = $5, powerbi_workspace_id = $6,
           powerbi_group_id = $6, enable_pagination = $7, rls_enabled = $8, rls_role_mapping = $9::jsonb,
           semanticmodel_id = COALESCE($11::uuid, semanticmodel_id),
           updated_at = NOW(), updated_by = $10::jsonb
       WHERE id = $1`,
      [
        id,
        name,
        body.description?.trim() ?? "",
        categoryId,
        pbiReport,
        workspace,
        Boolean(body.enablePagination),
        Boolean(body.rlsEnabled),
        rlsJson ? JSON.stringify(rlsJson) : null,
        audit,
        semanticModelId || null,
      ],
    );
  } else {
    const rlsJson = body.rlsEnabled ? buildRlsForCreate(body.powerBiRlsRole ?? []) : null;
    try {
      await db.query(
        `INSERT INTO bi_report (id, name, description, report_category, powerbi_report_id, powerbi_workspace_id, powerbi_group_id,
                               enable_pagination, rls_enabled, rls_role_mapping, is_active, created_at, updated_at, created_by, updated_by,
                               semanticmodel_id, application_type)
         VALUES ($1, $2, $3, $4, $5, $6, $6, $7, $8, $9::jsonb, true, NOW(), NOW(), $10::jsonb, $10::jsonb, $11::uuid, $12)`,
        [
          id,
          name,
          body.description?.trim() ?? "",
          categoryId,
          pbiReport,
          workspace,
          Boolean(body.enablePagination ?? true),
          Boolean(body.rlsEnabled),
          rlsJson ? JSON.stringify(rlsJson) : null,
          audit,
          semanticModelId,
          applicationType,
        ],
      );
    } catch (err: unknown) {
      const code = err && typeof err === "object" && "code" in err ? String((err as { code: string }).code) : "";
      if (code === "23505") return jsonOk({ message: "A report with this ID already exists" }, 409);
      if (code === "23503") return jsonOk({ message: "Department / category was not found" }, 400);
      throw err;
    }
  }
  invalidateAfterAdminWrite(ctx.email);
  return jsonOk(await listReportsPaged(ctx, DEFAULT_LIST));
}

export async function deleteReport(ctx: AdminContext, reportId: string) {
  const { deleteFabricApp, isFabricAppId } = await import("./bi-admin-fabric-apps");
  if (await isFabricAppId(reportId)) {
    return deleteFabricApp(ctx, reportId);
  }
  const audit = auditUserJson(ctx.userId, ctx.userName);
  await softDeleteRow("bi_report", reportId, audit);
  invalidateAfterAdminWrite(ctx.email);
  return jsonOk(await listReportsPaged(ctx, DEFAULT_LIST));
}

type ReportMapRequest = { rolesSelected?: string[]; bypassRLS?: boolean };

async function upsertGroupAccess(reportId: string, groupId: string, req: ReportMapRequest, audit: string) {
  const db = getDb();
  const existing = await db.query<{ id: string }>(
    `SELECT id::text FROM bi_report_role_access WHERE bi_report_id = $1 AND role_id = $2 AND is_active = true`,
    [reportId, groupId],
  );
  if (existing.rows[0]) {
    await db.query(
      `UPDATE bi_report_role_access SET "RLS_Bypassed" = $2, updated_at = NOW(), updated_by = $3::jsonb WHERE id = $1`,
      [existing.rows[0].id, Boolean(req.bypassRLS), audit],
    );
    return;
  }
  await db.query(
    `INSERT INTO bi_report_role_access (id, bi_report_id, role_id, "permission", "RLS_Bypassed", is_active, created_at, updated_at, created_by, updated_by)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, true, NOW(), NOW(), $5::jsonb, $5::jsonb)`,
    [reportId, groupId, REPORT_PERMISSION_VIEWER, Boolean(req.bypassRLS), audit],
  );
}

async function upsertUserAccess(reportId: string, userId: string, req: ReportMapRequest, audit: string) {
  const db = getDb();
  const user = await db.query<{ email_address: string }>(`SELECT email_address FROM users WHERE id = $1`, [userId]);
  const email = user.rows[0]?.email_address ?? "";
  const existing = await db.query<{ id: string }>(
    `SELECT id::text FROM bi_report_user_access WHERE bi_report_id = $1 AND user_id = $2 AND is_active = true`,
    [reportId, userId],
  );
  if (existing.rows[0]) {
    await db.query(
      `UPDATE bi_report_user_access SET "RLS_Bypassed" = $2, updated_at = NOW(), updated_by = $3::jsonb WHERE id = $1`,
      [existing.rows[0].id, Boolean(req.bypassRLS), audit],
    );
    return;
  }
  await db.query(
    `INSERT INTO bi_report_user_access (id, bi_report_id, user_id, email_address, external_user_id, "permission", "RLS_Bypassed", is_active, created_at, updated_at, created_by, updated_by)
     VALUES (gen_random_uuid(), $1, $2, $3, gen_random_uuid(), $4, $5, true, NOW(), NOW(), $6::jsonb, $6::jsonb)`,
    [reportId, userId, email, REPORT_PERMISSION_VIEWER, Boolean(req.bypassRLS), audit],
  );
}

export async function mapReportGroup(ctx: AdminContext, reportId: string, groupId: string, request: Request) {
  const { isFabricAppId, mapFabricAppGroup } = await import("./bi-admin-fabric-apps");
  if (await isFabricAppId(reportId)) {
    return mapFabricAppGroup(ctx, reportId, groupId, request);
  }
  const body = (await readJsonBody<ReportMapRequest>(request)) ?? {};
  const roles = body.rolesSelected ?? [];
  const audit = auditUserJson(ctx.userId, ctx.userName);
  const db = getDb();
  const report = await db.query<{ rls_enabled: boolean; rls_role_mapping: RlsMapping | null }>(
    `SELECT rls_enabled, rls_role_mapping FROM bi_report WHERE id = $1 AND is_active = true`,
    [reportId],
  );
  if (!report.rows[0]) return jsonOk({ message: "Report not found" }, 404);
  await upsertGroupAccess(reportId, groupId, body, audit);
  if (report.rows[0].rls_enabled && roles.length) {
    const next = mapEntityToRls(report.rows[0].rls_role_mapping, groupId, roles, false);
    await db.query(`UPDATE bi_report SET rls_role_mapping = $2::jsonb, updated_at = NOW(), updated_by = $3::jsonb WHERE id = $1`, [
      reportId,
      JSON.stringify(next),
      audit,
    ]);
  }
  invalidateAfterAdminWrite(ctx.email);
  return getReportAssigned(ctx, reportId);
}

export async function mapReportUser(ctx: AdminContext, reportId: string, userId: string, request: Request) {
  const { isFabricAppId, mapFabricAppUser } = await import("./bi-admin-fabric-apps");
  if (await isFabricAppId(reportId)) {
    return mapFabricAppUser(ctx, reportId, userId, request);
  }
  const body = (await readJsonBody<ReportMapRequest>(request)) ?? {};
  const roles = body.rolesSelected ?? [];
  const audit = auditUserJson(ctx.userId, ctx.userName);
  const db = getDb();
  const report = await db.query<{ rls_enabled: boolean; rls_role_mapping: RlsMapping | null }>(
    `SELECT rls_enabled, rls_role_mapping FROM bi_report WHERE id = $1 AND is_active = true`,
    [reportId],
  );
  if (!report.rows[0]) return jsonOk({ message: "Report not found" }, 404);
  await upsertUserAccess(reportId, userId, body, audit);
  if (report.rows[0].rls_enabled && roles.length) {
    const next = mapEntityToRls(report.rows[0].rls_role_mapping, userId, roles, true);
    await db.query(`UPDATE bi_report SET rls_role_mapping = $2::jsonb, updated_at = NOW(), updated_by = $3::jsonb WHERE id = $1`, [
      reportId,
      JSON.stringify(next),
      audit,
    ]);
  }
  invalidateAfterAdminWrite(ctx.email);
  return getReportAssigned(ctx, reportId);
}

type MappingDelete = { reportId?: string; mappingGroupId?: string; mappingUserId?: string };

export async function unmapReportGroup(ctx: AdminContext, request: Request) {
  const body = (await readJsonBody<MappingDelete>(request)) ?? {};
  if (!body.reportId || !body.mappingGroupId) return jsonOk({ message: "reportId and mappingGroupId required" }, 400);
  const { isFabricAppId, unmapFabricAppGroup } = await import("./bi-admin-fabric-apps");
  if (await isFabricAppId(body.reportId)) {
    return unmapFabricAppGroup(ctx, { reportId: body.reportId, mappingGroupId: body.mappingGroupId });
  }
  const audit = auditUserJson(ctx.userId, ctx.userName);
  const db = getDb();
  const mapped = await db.query<{ role_id: string }>(
    `SELECT role_id::text FROM bi_report_role_access WHERE id = $1 AND bi_report_id = $2 AND is_active = true`,
    [body.mappingGroupId, body.reportId],
  );
  const groupId = mapped.rows[0]?.role_id;
  await softDeleteRow("bi_report_role_access", body.mappingGroupId, audit);
  if (groupId) {
    const report = await db.query<{ rls_enabled: boolean; rls_role_mapping: RlsMapping | null }>(
      `SELECT rls_enabled, rls_role_mapping FROM bi_report WHERE id = $1`,
      [body.reportId],
    );
    if (report.rows[0]?.rls_enabled) {
      const next = removeEntityFromRls(report.rows[0].rls_role_mapping, groupId, false);
      await db.query(`UPDATE bi_report SET rls_role_mapping = $2::jsonb WHERE id = $1`, [body.reportId, JSON.stringify(next)]);
    }
  }
  invalidateAfterAdminWrite(ctx.email);
  return getReportAssigned(ctx, body.reportId);
}

export async function unmapReportUser(ctx: AdminContext, request: Request) {
  const body = (await readJsonBody<MappingDelete>(request)) ?? {};
  if (!body.reportId || !body.mappingUserId) return jsonOk({ message: "reportId and mappingUserId required" }, 400);
  const { isFabricAppId, unmapFabricAppUser } = await import("./bi-admin-fabric-apps");
  if (await isFabricAppId(body.reportId)) {
    return unmapFabricAppUser(ctx, { reportId: body.reportId, mappingUserId: body.mappingUserId });
  }
  const audit = auditUserJson(ctx.userId, ctx.userName);
  const db = getDb();
  const mapped = await db.query<{ user_id: string }>(
    `SELECT user_id::text FROM bi_report_user_access WHERE id = $1 AND bi_report_id = $2 AND is_active = true`,
    [body.mappingUserId, body.reportId],
  );
  const userId = mapped.rows[0]?.user_id;
  await softDeleteRow("bi_report_user_access", body.mappingUserId, audit);
  if (userId) {
    const report = await db.query<{ rls_enabled: boolean; rls_role_mapping: RlsMapping | null }>(
      `SELECT rls_enabled, rls_role_mapping FROM bi_report WHERE id = $1`,
      [body.reportId],
    );
    if (report.rows[0]?.rls_enabled) {
      const next = removeEntityFromRls(report.rows[0].rls_role_mapping, userId, true);
      await db.query(`UPDATE bi_report SET rls_role_mapping = $2::jsonb WHERE id = $1`, [body.reportId, JSON.stringify(next)]);
    }
  }
  invalidateAfterAdminWrite(ctx.email);
  return getReportAssigned(ctx, body.reportId);
}

export async function handleReportsGet(ctx: AdminContext, subpath: string) {
  const match = subpath.match(/^reports\/([^/]+)$/);
  if (match && !subpath.includes("/permission/")) {
    return getReportAssigned(ctx, match[1]);
  }
  return null;
}

export async function handleReportsPost(ctx: AdminContext, request: Request, subpath: string) {
  if (subpath === "getAllReports") {
    const body = await readJsonBody<PagedRequest>(request);
    return jsonOk(await listReportsPaged(ctx, body ?? DEFAULT_LIST));
  }
  if (subpath === "reports") {
    const body = await readJsonBody<ReportCreateRequest>(request);
    if (!body) return jsonOk({ message: "Invalid body" }, 400);
    return saveReport(ctx, body);
  }
  const groupPerm = subpath.match(/^reports\/([^/]+)\/permission\/group\/([^/]+)$/);
  if (groupPerm) {
    return mapReportGroup(ctx, groupPerm[1], groupPerm[2], request);
  }
  const userPerm = subpath.match(/^reports\/([^/]+)\/permission\/user\/([^/]+)$/);
  if (userPerm) {
    return mapReportUser(ctx, userPerm[1], userPerm[2], request);
  }
  return null;
}

export async function handleReportsPut(ctx: AdminContext, request: Request, subpath: string) {
  const match = subpath.match(/^reports\/([^/]+)$/);
  if (!match) return null;
  const body = await readJsonBody<ReportCreateRequest>(request);
  if (!body) return jsonOk({ message: "Invalid body" }, 400);
  return saveReport(ctx, body, match[1]);
}

export async function handleReportsDelete(ctx: AdminContext, request: Request, subpath: string) {
  if (subpath === "reports/permission/group") {
    return unmapReportGroup(ctx, request);
  }
  if (subpath === "reports/permission/user") {
    return unmapReportUser(ctx, request);
  }
  const match = subpath.match(/^reports\/([^/]+)$/);
  if (match && !subpath.includes("permission")) {
    return deleteReport(ctx, match[1]);
  }
  return null;
}
