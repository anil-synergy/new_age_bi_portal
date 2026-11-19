/**
 * Token-time RLS resolution from bi_report, access tables, user_roles, and rls_role_mapping JSON.
 */

import { getDevDbPool } from "./dev-db";
import { normalizeRls, uniqueRlsRoleNames, type RlsMapping } from "./reports-catalog";

const SYSTEM_ADMIN = "System Admin";

export type EmbedRlsContext = {
  catalogReportId: string;
  rlsEnabled: boolean;
  rlsBypassed: boolean;
  isSuperAdmin: boolean;
  roles: string[];
  powerBiReportId?: string;
  workspaceId?: string;
  semanticModelId?: string;
};

type ReportLookup = {
  catalogReportId?: string;
  workspaceId?: string;
  powerBiReportId?: string;
};

async function loadUserGroupContext(userId: string) {
  const db = getDevDbPool();
  const rolesRes = await db.query<{ id: string; name: string }>(
    `SELECT r.id, r.name
     FROM user_roles ur
     JOIN role r ON r.id = ur.role_id
     WHERE ur.user_id = $1 AND ur.is_active = true AND r.is_active = true`,
    [userId],
  );
  const groupIds = rolesRes.rows.map((r) => r.id);
  const isSuperAdmin = rolesRes.rows.some((r) => r.name === SYSTEM_ADMIN);
  return { groupIds, isSuperAdmin };
}

async function loadBypassForReport(userId: string, groupIds: string[], biReportId: string): Promise<boolean> {
  const db = getDevDbPool();
  const group = await db.query<{ rls_bypassed: boolean }>(
    `SELECT ra."RLS_Bypassed" AS rls_bypassed
     FROM bi_report_role_access ra
     INNER JOIN user_roles ur ON ur.role_id = ra.role_id AND ur.user_id = $1 AND ur.is_active = true
     WHERE ra.bi_report_id = $2 AND ra.is_active = true AND ra."RLS_Bypassed" = true
     LIMIT 1`,
    [userId, biReportId],
  );
  if (group.rows[0]?.rls_bypassed) return true;

  const user = await db.query<{ rls_bypassed: boolean }>(
    `SELECT "RLS_Bypassed" AS rls_bypassed
     FROM bi_report_user_access
     WHERE bi_report_id = $1 AND user_id = $2 AND is_active = true AND "RLS_Bypassed" = true
     LIMIT 1`,
    [biReportId, userId],
  );
  return Boolean(user.rows[0]?.rls_bypassed);
}

async function loadReportRow(lookup: ReportLookup) {
  const db = getDevDbPool();
  if (lookup.catalogReportId) {
    const byId = await db.query<{
      id: string;
      rls_enabled: boolean;
      rls_role_mapping: RlsMapping | null;
      powerbi_report_id: string;
      powerbi_workspace_id: string;
      semanticmodel_id: string | null;
    }>(
      `SELECT id, rls_enabled, rls_role_mapping, powerbi_report_id::text, powerbi_workspace_id::text, semanticmodel_id::text
       FROM bi_report WHERE id = $1 AND is_active = true`,
      [lookup.catalogReportId],
    );
    return byId.rows[0];
  }
  if (lookup.workspaceId && lookup.powerBiReportId) {
    const byPbi = await db.query<{
      id: string;
      rls_enabled: boolean;
      rls_role_mapping: RlsMapping | null;
      powerbi_report_id: string;
      powerbi_workspace_id: string;
      semanticmodel_id: string | null;
    }>(
      `SELECT id, rls_enabled, rls_role_mapping, powerbi_report_id::text, powerbi_workspace_id::text, semanticmodel_id::text
       FROM bi_report
       WHERE is_active = true
         AND lower(powerbi_report_id::text) = lower($1)
         AND lower(powerbi_workspace_id::text) = lower($2)
       LIMIT 1`,
      [lookup.powerBiReportId, lookup.workspaceId],
    );
    return byPbi.rows[0];
  }
  return undefined;
}

/** Resolve Power BI RLS role names and bypass flags at embed time (not from stale client state). */
export async function resolveEmbedRlsContext(
  userId: string,
  lookup: ReportLookup,
): Promise<EmbedRlsContext | null> {
  const row = await loadReportRow(lookup);
  if (!row) return null;

  const { groupIds, isSuperAdmin } = await loadUserGroupContext(userId);
  const rlsBypassed = isSuperAdmin ? false : await loadBypassForReport(userId, groupIds, row.id);

  // RLS datasets always need an identity with roles. Admins and bypass users get every role defined on
  // the report; everyone else gets the roles mapped to them.
  let roles: string[] = [];
  if (row.rls_enabled) {
    if (isSuperAdmin || rlsBypassed) {
      roles = uniqueRlsRoleNames(row.rls_role_mapping);
    } else {
      roles = normalizeRls(row.rls_role_mapping, userId, groupIds).map((r) => r.rlsRole).filter(Boolean);
    }
  }

  return {
    catalogReportId: row.id,
    rlsEnabled: row.rls_enabled,
    rlsBypassed,
    isSuperAdmin,
    roles,
    powerBiReportId: row.powerbi_report_id,
    workspaceId: row.powerbi_workspace_id,
    semanticModelId: row.semanticmodel_id ?? undefined,
  };
}
