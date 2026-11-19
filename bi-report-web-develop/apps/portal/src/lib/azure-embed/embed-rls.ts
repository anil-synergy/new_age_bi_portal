import type { EffectiveIdentity, PortalReport } from "@/types";
import { isRealGuid } from "./ids";

/** Power BI rejected the call because RLS roles are required but none were supplied. */
export class RlsRolesRequiredError extends Error {
  constructor(message = "This dataset requires RLS roles in the embed token. Map the signed-in user or group to a Power BI role for this report.") {
    super(message);
    this.name = "RlsRolesRequiredError";
  }
}

export function needsEffectiveIdentity(text: string): boolean {
  return text.toLowerCase().includes("effective identity");
}

export function needsWorkspaceIdentityError(text: string): boolean {
  const upper = text.toUpperCase();
  return upper.includes("PREMIUM_ASWL") || text.toLowerCase().includes("workspace identity");
}

export function buildRlsIdentities(username: string, roles: string[], datasetId: string) {
  if (!username || !roles.length || !datasetId) return undefined;
  return [{ username, roles, datasets: [datasetId] }];
}

/** Identity required for every active RLS embed (admin/bypass use all catalog roles). */
export function shouldApplyRlsIdentity(report: PortalReport | undefined, _isSuperAdmin: boolean): boolean {
  if (!report?.rlsEnabled) return false;
  return true;
}

/** Build effectiveIdentity for BI_Portal_Auth when RLS applies; otherwise undefined (Live/DQ as Function SPN). */
export function buildEmbedEffectiveIdentity(
  report: PortalReport | undefined,
  isSuperAdmin: boolean,
  username: string,
  roles: string[],
  datasetId?: string,
): EffectiveIdentity | undefined {
  if (!shouldApplyRlsIdentity(report, isSuperAdmin)) return undefined;
  return buildPoSpendEffectiveIdentity(username, roles, datasetId);
}

/** PO_SPEND pattern: username + roles + datasets for GenerateToken / BI_Portal_Auth. */
export function buildPoSpendEffectiveIdentity(
  username: string,
  roles: string[],
  datasetId?: string,
): EffectiveIdentity | undefined {
  if (!roles.length || !username) return undefined;
  return buildFunctionEffectiveIdentity(username, roles, datasetId);
}

/** Function body: UPN + roles (may be empty) + optional dataset GUID. */
export function buildFunctionEffectiveIdentity(
  username: string,
  roles: string[],
  datasetId?: string,
): EffectiveIdentity | undefined {
  const u = username.trim();
  if (!u) return undefined;
  const identity: EffectiveIdentity = { username: u, roles: [...roles] };
  if (datasetId && isRealGuid(datasetId)) {
    identity.datasets = [datasetId];
  }
  return identity;
}

export function buildEmbedEffectiveIdentityFromFlags(
  rlsEnabled: boolean,
  rlsBypassed: boolean,
  isSuperAdmin: boolean,
  username: string,
  roles: string[],
  datasetId?: string,
): EffectiveIdentity | undefined {
  const report = { rlsEnabled, rlsBypassed } as PortalReport;
  return buildEmbedEffectiveIdentity(report, isSuperAdmin, username, roles, datasetId);
}

/**
 * RLS role names to send in the effective identity for an RLS-enabled report.
 * - Normal user: the roles mapped to this user/group in the portal DB.
 * - System Admin or RLS bypass: every role defined on the report (Power BI requires an identity with roles
 *   on an RLS dataset, so these users must not be sent without one).
 */
export function embedRolesForReport(report: PortalReport, isSuperAdmin: boolean): string[] {
  if (!report.rlsEnabled) return [];
  if (isSuperAdmin || report.rlsBypassed) {
    return report.allRlsRoleNames ?? [];
  }
  return (report.powerBiRlsRole ?? []).map((r) => r.rlsRole).filter(Boolean);
}
