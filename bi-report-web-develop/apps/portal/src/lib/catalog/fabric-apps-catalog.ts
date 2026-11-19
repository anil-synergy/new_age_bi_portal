import type { PortalReport } from "@/types";
import { getDevDbPool } from "./dev-db";
import { normalizeRls, uniqueRlsRoleNames, type RlsMapping } from "./reports-catalog";

type DbPool = ReturnType<typeof getDevDbPool>;

export interface FabricCatalogRow {
  id: string;
  title: string;
  description: string | null;
  hosting_url: string;
  workspace_id: string;
  app_id: string;
  semanticmodel_id: string | null;
  rls_enabled: boolean;
  rls_role_mapping: RlsMapping | null;
  category_id: string | null;
  category_name: string | null;
  rls_bypassed: boolean;
}

function toFabricPortalReport(
  row: FabricCatalogRow,
  userId: string,
  groupIds: string[],
  isSuperAdmin: boolean,
  favoriteIds: Set<string>,
): PortalReport {
  const powerBiRlsRole = !isSuperAdmin ? normalizeRls(row.rls_role_mapping, userId, groupIds) : [];
  return {
    id: row.id,
    title: row.title,
    name: row.title,
    description: row.description ?? undefined,
    applicationType: "fabric-rayfin",
    hostingUrl: row.hosting_url,
    fabricAppId: row.app_id,
    workspaceId: row.workspace_id,
    powerWorkSpaceId: row.workspace_id,
    semanticModelId: row.semanticmodel_id ?? undefined,
    powerBiReportId: row.app_id,
    sourceType: "powerbi",
    rlsEnabled: row.rls_enabled,
    rlsBypassed: row.rls_bypassed,
    powerBiRlsRole,
    allRlsRoleNames: uniqueRlsRoleNames(row.rls_role_mapping),
    enablePagination: false,
    categoryName: row.category_name ?? undefined,
    categoryId: row.category_id ?? undefined,
    favorite: favoriteIds.has(row.id.toLowerCase()),
  };
}

/** Entitled Fabric Rayfin apps for the menu (same group/user/dep-admin rules as bi_report). */
export async function loadFabricAppsForCatalog(
  db: DbPool,
  userId: string,
  groupIds: string[],
  isSuperAdmin: boolean,
  departmentIds: string[],
  favoriteIds: Set<string>,
): Promise<PortalReport[]> {
  try {
    let sql: string;
    const params: unknown[] = [userId];

    if (isSuperAdmin) {
      sql = `
        SELECT
          fa.id::text,
          fa.app_name AS title,
          fa.description,
          fa.hosting_url,
          fa.workspace_id::text,
          fa.app_id::text,
          fa.semanticmodel_id::text,
          fa.rls_enabled,
          fa.rls_role_mapping,
          c.id::text AS category_id,
          c.name AS category_name,
          false AS rls_bypassed
        FROM bi_fabric_apps fa
        LEFT JOIN bi_report_categories c ON c.id = fa.report_category
        WHERE fa.is_active = true`;
    } else {
      sql = `
        SELECT DISTINCT ON (fa.id)
          fa.id::text,
          fa.app_name AS title,
          fa.description,
          fa.hosting_url,
          fa.workspace_id::text,
          fa.app_id::text,
          fa.semanticmodel_id::text,
          fa.rls_enabled,
          fa.rls_role_mapping,
          c.id::text AS category_id,
          c.name AS category_name,
          COALESCE(ra."RLS_Bypassed", ua."RLS_Bypassed", false) AS rls_bypassed
        FROM bi_fabric_apps fa
        LEFT JOIN bi_report_categories c ON c.id = fa.report_category
        LEFT JOIN bi_fabric_app_role_access ra
          ON ra.bi_fabric_app_id = fa.id AND ra.is_active = true
        LEFT JOIN user_roles ur
          ON ur.role_id = ra.role_id AND ur.user_id = $1 AND ur.is_active = true
        LEFT JOIN bi_fabric_app_user_access ua
          ON ua.bi_fabric_app_id = fa.id AND ua.user_id = $1 AND ua.is_active = true
        WHERE fa.is_active = true
          AND (
            ur.user_id IS NOT NULL
            OR ua.user_id IS NOT NULL
            ${departmentIds.length ? "OR fa.report_category = ANY($2::uuid[])" : ""}
          )
        ORDER BY fa.id`;
      if (departmentIds.length) params.push(departmentIds);
    }

    const res = await db.query<FabricCatalogRow>(sql, isSuperAdmin ? [] : params);
    const entitled: PortalReport[] = [];

    for (const row of res.rows) {
      if (row.rls_enabled && !isSuperAdmin && !row.rls_bypassed) {
        const mapped = normalizeRls(row.rls_role_mapping, userId, groupIds);
        if (!row.rls_role_mapping) continue;
        const mappings = row.rls_role_mapping.RoleMappings ?? row.rls_role_mapping.roleMappings ?? [];
        const hasAnyActive = mappings.some((m) => (m.IsActive ?? m.isActive) !== false && (m.RlsRole ?? m.rlsRole));
        if (hasAnyActive && mapped.length === 0) continue;
      }
      entitled.push(toFabricPortalReport(row, userId, groupIds, isSuperAdmin, favoriteIds));
    }
    return entitled;
  } catch (error) {
    console.error("[fabric-apps-catalog] loadFabricAppsForCatalog failed:", error);
    return [];
  }
}

/** Entitled Fabric row by portal catalog id (`bi_fabric_apps.id`), or null if missing / no access. */
export async function loadEntitledFabricPortalReportById(
  catalogId: string,
  userId: string,
  groupIds: string[],
  isSuperAdmin: boolean,
  departmentIds: string[],
  favoriteIds: Set<string>,
): Promise<PortalReport | null> {
  const db = getDevDbPool();
  const apps = await loadFabricAppsForCatalog(db, userId, groupIds, isSuperAdmin, departmentIds, favoriteIds);
  return apps.find((r) => r.id === catalogId) ?? null;
}

/** Every active Fabric app (no per-user filter). For SMART metadata sync only. */
export async function loadAllActiveFabricApps(db: DbPool): Promise<PortalReport[]> {
  try {
    const res = await db.query<FabricCatalogRow>(
      `SELECT
          fa.id::text,
          fa.app_name AS title,
          fa.description,
          fa.hosting_url,
          fa.workspace_id::text,
          fa.app_id::text,
          fa.semanticmodel_id::text,
          fa.rls_enabled,
          fa.rls_role_mapping,
          c.id::text AS category_id,
          c.name AS category_name,
          false AS rls_bypassed
        FROM bi_fabric_apps fa
        LEFT JOIN bi_report_categories c ON c.id = fa.report_category
        WHERE fa.is_active = true`,
    );
    return res.rows.map((row) => toFabricPortalReport(row, "", [], true, new Set<string>()));
  } catch {
    return [];
  }
}

export async function loadFabricAppByCatalogId(catalogId: string): Promise<FabricCatalogRow | null> {
  try {
    const { getDevDbPool } = await import("./dev-db");
    const db = getDevDbPool();
    const res = await db.query<FabricCatalogRow>(
      `SELECT fa.id::text, fa.app_name AS title, fa.description, fa.hosting_url, fa.workspace_id::text,
              fa.app_id::text, fa.semanticmodel_id::text, fa.rls_enabled, fa.rls_role_mapping,
              fa.report_category::text AS category_id, c.name AS category_name, false AS rls_bypassed
       FROM bi_fabric_apps fa
       LEFT JOIN bi_report_categories c ON c.id = fa.report_category
       WHERE fa.id = $1 AND fa.is_active = true`,
      [catalogId],
    );
    return res.rows[0] ?? null;
  } catch {
    return null;
  }
}