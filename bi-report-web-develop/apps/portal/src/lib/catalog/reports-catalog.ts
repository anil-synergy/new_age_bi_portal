import type { CategoryPathItem, PortalReport, UserInfo } from "@/types";
import { getDevDbPool } from "./dev-db";
import { buildCategoryPath } from "./category-hierarchy";

const SYSTEM_ADMIN = "System Admin";

interface RoleRow {
  id: string;
  name: string;
}

interface UserRow {
  id: string;
  name: string;
  email_address: string;
}

interface ReportRow {
  id: string;
  title: string;
  description: string | null;
  powerbi_report_id: string;
  powerbi_workspace_id: string;
  semanticmodel_id: string | null;
  enable_pagination: boolean;
  rls_enabled: boolean;
  rls_role_mapping: RlsMapping | null;
  category_id: string | null;
  category_name: string | null;
  rls_bypassed: boolean;
}

export interface RlsMapping {
  RoleMappings?: Array<{
    Id?: string;
    id?: string;
    RlsRole?: string;
    rlsRole?: string;
    Users?: string[];
    users?: string[];
    Groups?: string[];
    groups?: string[];
    IsActive?: boolean;
    isActive?: boolean;
  }>;
  roleMappings?: RlsMapping["RoleMappings"];
}

export function uniqueRlsRoleNames(raw: RlsMapping | null): string[] {
  const mappings = raw?.RoleMappings ?? raw?.roleMappings ?? [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of mappings) {
    if ((m.IsActive ?? m.isActive) === false) continue;
    const role = String(m.RlsRole ?? m.rlsRole ?? "").trim();
    if (!role || seen.has(role.toLowerCase())) continue;
    seen.add(role.toLowerCase());
    out.push(role);
  }
  return out;
}

export function normalizeRls(raw: RlsMapping | null, userId: string, groupIds: string[]) {
  const mappings = raw?.RoleMappings ?? raw?.roleMappings ?? [];
  return mappings
    .filter((m) => (m.IsActive ?? m.isActive) !== false)
    .filter((m) => {
      const role = m.RlsRole ?? m.rlsRole;
      if (!role) return false;
      // Case-insensitive: GUIDs stored in the mapping JSON and in the user/role tables can differ in case.
      const uid = userId.toLowerCase();
      const gids = new Set(groupIds.map((g) => g.toLowerCase()));
      const users = m.Users ?? m.users ?? [];
      const groups = m.Groups ?? m.groups ?? [];
      return users.some((u) => u.toLowerCase() === uid) || groups.some((g) => gids.has(g.toLowerCase()));
    })
    .map((m) => ({
      id: String(m.Id ?? m.id ?? ""),
      rlsRole: String(m.RlsRole ?? m.rlsRole),
    }));
}

function toPortalReport(
  row: ReportRow,
  userId: string,
  groupIds: string[],
  isSuperAdmin: boolean,
  favoriteIds: Set<string>
): PortalReport {
  const powerBiRlsRole = !isSuperAdmin ? normalizeRls(row.rls_role_mapping, userId, groupIds) : [];
  return {
    id: row.id,
    title: row.title,
    name: row.title,
    description: row.description ?? undefined,
    powerBiReportId: row.powerbi_report_id,
    workspaceId: row.powerbi_workspace_id,
    powerWorkSpaceId: row.powerbi_workspace_id,
    semanticModelId: row.semanticmodel_id ?? undefined,
    sourceType: "powerbi",
    rlsEnabled: row.rls_enabled,
    rlsBypassed: row.rls_bypassed,
    powerBiRlsRole,
    allRlsRoleNames: uniqueRlsRoleNames(row.rls_role_mapping),
    enablePagination: row.enable_pagination,
    categoryName: row.category_name ?? undefined,
    categoryId: row.category_id ?? undefined,
    favorite: favoriteIds.has(row.id.toLowerCase()),
  };
}

type DbPool = ReturnType<typeof getDevDbPool>;

// parent_id/display_order exist only in some environments' schema (not in the API's EF migrations).
let hierarchySupported: boolean | undefined;

async function loadCategoryHierarchy(db: DbPool): Promise<Map<string, CategoryPathItem> | undefined> {
  try {
    if (hierarchySupported === undefined) {
      const probe = await db.query<{ n: string }>(
        `SELECT count(*) AS n FROM information_schema.columns
         WHERE table_schema = current_schema() AND table_name = 'bi_report_categories'
           AND column_name IN ('parent_id', 'display_order')`
      );
      hierarchySupported = Number(probe.rows[0]?.n) === 2;
    }
    if (!hierarchySupported) return undefined;
    const res = await db.query<{ id: string; name: string | null; parent_id: string | null; display_order: number }>(
      `SELECT id::text, name, parent_id::text, display_order
       FROM bi_report_categories WHERE is_active = true`
    );
    return new Map(
      res.rows.map((row) => [
        row.id,
        { id: row.id, name: row.name ?? "", parentId: row.parent_id, displayOrder: row.display_order ?? 0 },
      ])
    );
  } catch {
    return undefined;
  }
}

type CatalogResult = {
  userInfo: UserInfo;
  reports: PortalReport[];
  userFound: boolean;
  isSuperAdmin: boolean;
  isDepAdmin: boolean;
};

const CATALOG_TTL_MS = 30_000;
const catalogCache = new Map<string, { at: number; result: Promise<CatalogResult> }>();

/** Shares one DB round-trip between the parallel reports and user-info requests. */
export function loadCatalogForEmail(email: string): Promise<CatalogResult> {
  const key = email.trim().toLowerCase();
  const hit = catalogCache.get(key);
  if (hit && Date.now() - hit.at < CATALOG_TTL_MS) return hit.result;
  const result = queryCatalogForEmail(email);
  catalogCache.set(key, { at: Date.now(), result });
  result.catch(() => catalogCache.delete(key));
  return result;
}

export function invalidateCatalogCache(email: string): void {
  catalogCache.delete(email.trim().toLowerCase());
}

export function invalidateAllCatalogCaches(): void {
  catalogCache.clear();
  hierarchySupported = undefined;
}

/** Resolve one menu id from Postgres: Fabric (`bi_fabric_apps`) before Power BI (`bi_report`). */
export async function resolveCatalogReportForUser(email: string, catalogId: string): Promise<PortalReport | null> {
  const catalog = await loadCatalogForEmail(email);
  if (!catalog.userFound || !catalog.userInfo.id) return null;

  const { loadEntitledFabricPortalReportById, loadFabricAppByCatalogId } = await import("./fabric-apps-catalog");
  const { isFabricRayfinCatalogReport } = await import("./fabric-rayfin-detect");

  const groupIds = (catalog.userInfo.group ?? []).map((g) => g.id);
  const favoriteIds = new Set(
    catalog.reports.filter((r) => r.favorite).map((r) => r.id.toLowerCase()),
  );

  // Department category ids — same probe as queryCatalogForEmail (inline to avoid duplicating cache).
  const db = getDevDbPool();
  const deptRes = await db
    .query<{ id: string }>(
      `SELECT id FROM bi_report_categories
       WHERE is_active = true AND department_admin IS NOT NULL
         AND (department_admin @> to_jsonb($1::text) OR department_admin @> to_jsonb($1::uuid))`,
      [catalog.userInfo.id],
    )
    .catch(() => ({ rows: [] as { id: string }[] }));
  const departmentIds = deptRes.rows.map((d) => d.id);

  const fabricReport = await loadEntitledFabricPortalReportById(
    catalogId,
    catalog.userInfo.id,
    groupIds,
    catalog.isSuperAdmin,
    departmentIds,
    favoriteIds,
  );
  if (fabricReport) return fabricReport;

  const fabricMaster = await loadFabricAppByCatalogId(catalogId);
  if (fabricMaster) {
    // Row exists in bi_fabric_apps but user is not entitled (or RLS mapping excluded them).
    return null;
  }

  const powerBi = catalog.reports.find((r) => r.id === catalogId);
  if (powerBi && !isFabricRayfinCatalogReport(powerBi)) return powerBi;
  return powerBi ?? null;
}

/** @visibleForTesting */
export function resetCategoryHierarchyProbeForTests(): void {
  hierarchySupported = undefined;
}

function auditUserJson(userId: string, userName: string): string {
  return JSON.stringify({ Id: userId, Name: userName || userId });
}

/** Toggles favorite for a catalog user; mirrors bi-report-api soft-delete / reactivate. */
export async function toggleFavoriteForUser(userId: string, userName: string, reportId: string): Promise<void> {
  const db = getDevDbPool();
  const audit = auditUserJson(userId, userName);
  const fabric =
    (await db.query<{ ok: number }>(`SELECT 1 AS ok FROM bi_fabric_apps WHERE id = $1 AND is_active = true LIMIT 1`, [reportId]).catch(
      () => ({ rows: [] as { ok: number }[] }),
    )).rows.length > 0;
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const exist = fabric
      ? await client
          .query<{ id: string; is_active: boolean }>(
            `SELECT id::text, is_active FROM bi_user_favorites WHERE user_id = $1 AND bi_fabric_app_id = $2`,
            [userId, reportId],
          )
          .catch(() => ({ rows: [] as { id: string; is_active: boolean }[] }))
      : await client.query<{ id: string; is_active: boolean }>(
          `SELECT id::text, is_active FROM bi_user_favorites WHERE user_id = $1 AND bi_report_id = $2`,
          [userId, reportId],
        );
    const row = exist.rows[0];
    if (row?.is_active) {
      await client.query(
        `UPDATE bi_user_favorites
         SET is_active = false, deleted_at = NOW(), deleted_by = $2::jsonb, updated_at = NOW(), updated_by = $2::jsonb
         WHERE id = $1`,
        [row.id, audit]
      );
    } else if (row && !row.is_active) {
      await client.query(
        `UPDATE bi_user_favorites
         SET is_active = true, deleted_at = NULL, deleted_by = NULL, updated_at = NOW(), updated_by = $2::jsonb
         WHERE id = $1`,
        [row.id, audit]
      );
    } else if (fabric) {
      await client.query(
        `INSERT INTO bi_user_favorites (id, user_id, bi_fabric_app_id, is_active, created_at, updated_at, created_by, updated_by)
         VALUES (gen_random_uuid(), $1, $2, true, NOW(), NOW(), $3::jsonb, $3::jsonb)`,
        [userId, reportId, audit],
      );
    } else {
      await client.query(
        `INSERT INTO bi_user_favorites (id, user_id, bi_report_id, is_active, created_at, updated_at, created_by, updated_by)
         VALUES (gen_random_uuid(), $1, $2, true, NOW(), NOW(), $3::jsonb, $3::jsonb)`,
        [userId, reportId, audit]
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Service-level read of every active report (no per-user entitlement or RLS filtering).
 * Only for the SMART metadata sync; callers must authenticate as the service, never a user.
 */
export async function loadAllActiveReports(): Promise<PortalReport[]> {
  const db = getDevDbPool();
  const res = await db.query<ReportRow>(
    `SELECT
       br.id,
       br.name AS title,
       br.description,
       br.powerbi_report_id::text,
       br.powerbi_workspace_id::text, br.semanticmodel_id::text,
       br.enable_pagination,
       br.rls_enabled,
       br.rls_role_mapping,
       c.id::text AS category_id,
       c.name AS category_name,
       false AS rls_bypassed
     FROM bi_report br
     LEFT JOIN bi_report_categories c ON c.id = br.report_category
     WHERE br.is_active = true`
  );
  const { loadAllActiveFabricApps } = await import("./fabric-apps-catalog");
  const fabricReports = await loadAllActiveFabricApps(db);
  const reports = [
    ...res.rows.map((row) => toPortalReport(row, "", [], true, new Set<string>())),
    ...fabricReports,
  ];
  reports.sort(
    (a, b) => (a.categoryName ?? "").localeCompare(b.categoryName ?? "") || a.title.localeCompare(b.title)
  );
  const categories = await loadCategoryHierarchy(db);
  if (categories) {
    for (const report of reports) report.categoryPath = buildCategoryPath(categories, report.categoryId);
  }
  return reports;
}

async function queryCatalogForEmail(email: string): Promise<CatalogResult> {
  const db = getDevDbPool();
  const userRes = await db.query<UserRow>(
    `SELECT id, name, email_address
     FROM users
     WHERE lower(trim(email_address)) = lower(trim($1))
       AND is_active = true
     LIMIT 1`,
    [email]
  );

  const user = userRes.rows[0];
  if (!user) {
    return {
      userFound: false,
      isSuperAdmin: false,
      isDepAdmin: false,
      userInfo: { isSuperAdmin: false, isDepartmentAdmin: false, email, group: [] },
      reports: [],
    };
  }

  const [rolesRes, deptRes, favRes] = await Promise.all([
    db.query<RoleRow>(
      `SELECT r.id, r.name
       FROM user_roles ur
       JOIN role r ON r.id = ur.role_id
       WHERE ur.user_id = $1
         AND ur.is_active = true
         AND r.is_active = true`,
      [user.id],
    ),
    db
      .query<{ id: string }>(
      `SELECT id
       FROM bi_report_categories
       WHERE is_active = true
         AND department_admin IS NOT NULL
         AND (
           department_admin @> to_jsonb($1::text)
           OR department_admin @> to_jsonb($1::uuid)
         )`,
        [user.id],
      )
      .catch(() => ({ rows: [] as { id: string }[] })),
    db
      .query<{ bi_report_id: string | null; bi_fabric_app_id: string | null }>(
        `SELECT bi_report_id::text, bi_fabric_app_id::text
         FROM bi_user_favorites WHERE user_id = $1 AND is_active = true`,
        [user.id],
      )
      .catch(() => db.query<{ bi_report_id: string }>(
        `SELECT bi_report_id::text FROM bi_user_favorites WHERE user_id = $1 AND is_active = true`,
        [user.id],
      ).then((r) => ({ rows: r.rows.map((x) => ({ bi_report_id: x.bi_report_id, bi_fabric_app_id: null })) }))),
  ]);
  const roles = rolesRes.rows;
  const groupIds = roles.map((r) => r.id);
  const roleNames = roles.map((r) => r.name);
  const isSuperAdmin = roleNames.some((n) => n === SYSTEM_ADMIN);

  const departmentIds = deptRes.rows.map((d) => d.id);
  const isDepAdmin = departmentIds.length > 0;

  const favoriteIds = new Set(
    favRes.rows
      .map((f) => (f.bi_fabric_app_id ?? f.bi_report_id ?? "").toLowerCase())
      .filter(Boolean),
  );

  let reportSql: string;
  const params: unknown[] = [user.id];

  if (isSuperAdmin) {
    reportSql = `
      SELECT
        br.id,
        br.name AS title,
        br.description,
        br.powerbi_report_id::text,
        br.powerbi_workspace_id::text, br.semanticmodel_id::text,
        br.enable_pagination,
        br.rls_enabled,
        br.rls_role_mapping,
        c.id::text AS category_id,
        c.name AS category_name,
        false AS rls_bypassed
      FROM bi_report br
      LEFT JOIN bi_report_categories c ON c.id = br.report_category
      WHERE br.is_active = true`;
  } else {
    reportSql = `
      SELECT DISTINCT ON (br.id)
        br.id,
        br.name AS title,
        br.description,
        br.powerbi_report_id::text,
        br.powerbi_workspace_id::text, br.semanticmodel_id::text,
        br.enable_pagination,
        br.rls_enabled,
        br.rls_role_mapping,
        c.id::text AS category_id,
        c.name AS category_name,
        COALESCE(ra."RLS_Bypassed", ua."RLS_Bypassed", false) AS rls_bypassed
      FROM bi_report br
      LEFT JOIN bi_report_categories c ON c.id = br.report_category
      LEFT JOIN bi_report_role_access ra
        ON ra.bi_report_id = br.id AND ra.is_active = true
      LEFT JOIN user_roles ur
        ON ur.role_id = ra.role_id AND ur.user_id = $1 AND ur.is_active = true
      LEFT JOIN bi_report_user_access ua
        ON ua.bi_report_id = br.id AND ua.user_id = $1 AND ua.is_active = true
      WHERE br.is_active = true
        AND (
          ur.user_id IS NOT NULL
          OR ua.user_id IS NOT NULL
          ${departmentIds.length ? "OR br.report_category = ANY($2::uuid[])" : ""}
        )
      ORDER BY br.id`;
    if (departmentIds.length) params.push(departmentIds);
  }

  const reportParams = isSuperAdmin ? [] : params;
  const reportsRes = await db.query<ReportRow>(reportSql, reportParams);
  const entitled: PortalReport[] = [];

  for (const row of reportsRes.rows) {
    if (row.rls_enabled && !isSuperAdmin && !row.rls_bypassed) {
      const mapped = normalizeRls(row.rls_role_mapping, user.id, groupIds);
      if (!row.rls_role_mapping) continue;
      const mappings = row.rls_role_mapping.RoleMappings ?? row.rls_role_mapping.roleMappings ?? [];
      const hasAnyActive = mappings.some((m) => (m.IsActive ?? m.isActive) !== false && (m.RlsRole ?? m.rlsRole));
      if (hasAnyActive && mapped.length === 0) continue;
    }
    entitled.push(toPortalReport(row, user.id, groupIds, isSuperAdmin, favoriteIds));
  }

  const { loadFabricAppsForCatalog } = await import("./fabric-apps-catalog");
  const fabricApps = await loadFabricAppsForCatalog(
    db,
    user.id,
    groupIds,
    isSuperAdmin,
    departmentIds,
    favoriteIds,
  );
  entitled.push(...fabricApps);

  entitled.sort((a, b) => (a.categoryName ?? "").localeCompare(b.categoryName ?? "") || a.title.localeCompare(b.title));

  const categories = await loadCategoryHierarchy(db);
  if (categories) {
    for (const report of entitled) report.categoryPath = buildCategoryPath(categories, report.categoryId);
  }

  return {
    userFound: true,
    isSuperAdmin,
    isDepAdmin,
    reports: entitled,
    userInfo: {
      id: user.id,
      isSuperAdmin,
      isDepartmentAdmin: isDepAdmin,
      email: user.email_address,
      name: user.name,
      group: roles.map((r) => ({ id: r.id, name: r.name })),
    },
  };
}
