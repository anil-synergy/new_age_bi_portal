import type { EffectiveIdentity } from "@/types";
import { buildFunctionEffectiveIdentity } from "./embed-rls";
import { isRealGuid } from "./ids";

/** User has RLS on report but no mapped role in portal DB (do not mint unrestricted token). */
export class EmbedMissingRlsConfigError extends Error {
  constructor(
    message = "This report requires a Power BI RLS role mapping for your account. Ask an administrator to map your user or group.",
  ) {
    super(message);
    this.name = "EmbedMissingRlsConfigError";
  }
}

export type EmbedPayloadPolicyInput = {
  /** Signed-in UPN/email from server session only (never from client body). */
  signedInEmail: string;
  /** Power BI role names from portal DB (`resolveEmbedRlsContext`). */
  roles: string[];
  datasetId?: string;
  isSuperAdmin?: boolean;
  rlsEnabled?: boolean;
  rlsBypassed?: boolean;
};

export type EmbedPayloadPolicy = {
  username: string;
  roles: string[];
  effectiveIdentity?: EffectiveIdentity;
  skipIdentity: boolean;
  /** Live/DQ gateway: ask BI_Portal_Auth to attach datasource SSO when supported. */
  applyDatasourceIdentity?: boolean;
};

/** Session UPN, or Hawkeye SP App ID only when UPN is unavailable (never object ID). */
export function embedUsernameFromSession(signedInEmail: string): string {
  const upn = signedInEmail.trim();
  if (upn) return upn;
  return embedServicePrincipalAppId();
}

/** Hawkeye embed service principal **application (client) id** for workspace-identity datasets (never object id). */
export function embedServicePrincipalAppId(): string {
  return (
    process.env.PBI_EMBED_SP_CLIENT_ID?.trim() ||
    process.env.PBI_CLIENT_ID?.trim() ||
    process.env.SMART_PBI_CLIENT_ID?.trim() ||
    ""
  );
}

/**
 * Datasets that need Live/DQ workspace-identity embed (`skipIdentity: false`, empty roles, datasets scoped).
 * Additional ids may be listed in `PBI_WORKSPACE_IDENTITY_DATASET_IDS`.
 */
const DEFAULT_WORKSPACE_IDENTITY_DATASET_IDS: string[] = ["2e33f17a-0b33-4d3a-9441-69ed9aebc017"];

export function datasetUsesWorkspaceIdentityEmbed(datasetId?: string): boolean {
  if (!datasetId || !isRealGuid(datasetId)) return false;
  const fromEnv = (process.env.PBI_WORKSPACE_IDENTITY_DATASET_IDS ?? "")
    .split(/[,;\s]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const allowed = new Set([...DEFAULT_WORKSPACE_IDENTITY_DATASET_IDS.map((id) => id.toLowerCase()), ...fromEnv]);
  return allowed.has(datasetId.trim().toLowerCase());
}

/** Live/DQ: session UPN for users; Hawkeye SP app id for System Admin; SP fallback if no UPN. */
export function embedUsernameForLiveDq(signedInEmail: string, isSuperAdmin: boolean): string {
  if (isSuperAdmin) {
    const appId = embedServicePrincipalAppId();
    if (!appId) {
      throw new Error(
        "This dataset requires workspace identity embed for System Admin. Set PBI_EMBED_SP_CLIENT_ID.",
      );
    }
    return appId;
  }
  const username = embedUsernameFromSession(signedInEmail);
  if (!username) {
    throw new Error(
      "This dataset requires workspace identity embed. Sign in with your work account or set PBI_EMBED_SP_CLIENT_ID.",
    );
  }
  return username;
}

function buildWorkspaceIdentityPayload(identityUsername: string, datasetId: string): EmbedPayloadPolicy {
  const effectiveIdentity: EffectiveIdentity = {
    username: identityUsername,
    roles: [],
    datasets: [datasetId],
  };
  return {
    username: identityUsername,
    roles: [],
    effectiveIdentity,
    skipIdentity: false,
    applyDatasourceIdentity: true,
  };
}

/**
 * Proven BI_Portal_Auth contract:
 * - Active RLS: UPN + roles + skipIdentity false + effectiveIdentity (admin gets all catalog roles)
 * - Live/DQ allowlist: UPN or SP app id + skipIdentity false + empty roles + datasets
 * - Import otherwise: skipIdentity true (no effectiveIdentity)
 */
export function resolveEmbedPayloadPolicy(input: EmbedPayloadPolicyInput): EmbedPayloadPolicy {
  const roles = [...input.roles];
  const rlsEnabled = input.rlsEnabled ?? false;
  const rlsBypassed = Boolean(input.rlsBypassed);
  const isSuperAdmin = Boolean(input.isSuperAdmin);
  const username = embedUsernameFromSession(input.signedInEmail);

  if (!username) {
    throw new Error("Could not resolve a username for embed (sign in or set PBI_EMBED_SP_CLIENT_ID server-side).");
  }

  if (rlsEnabled && roles.length === 0) {
    throw new EmbedMissingRlsConfigError(
      isSuperAdmin || rlsBypassed
        ? "This report has RLS enabled but no Power BI RLS roles are defined for it. Add the RLS roles in Administration."
        : "This report has RLS enabled but your user is not assigned to a Power BI role on this report. In Administration, add your user or portal group to the RLS role mapping (for example Bluelink Users).",
    );
  }

  const activeRls = rlsEnabled && roles.length > 0;
  if (activeRls) {
    const policy: EmbedPayloadPolicy = {
      username,
      roles,
      effectiveIdentity: buildFunctionEffectiveIdentity(username, roles, input.datasetId),
      skipIdentity: false,
    };
    return policy;
  }

  const datasetId = input.datasetId?.trim();
  if (rlsEnabled === false && datasetId && isRealGuid(datasetId) && datasetUsesWorkspaceIdentityEmbed(datasetId)) {
    const identityUsername = embedUsernameForLiveDq(input.signedInEmail, isSuperAdmin);
    return buildWorkspaceIdentityPayload(identityUsername, datasetId);
  }

  return {
    username,
    roles: [],
    effectiveIdentity: undefined,
    skipIdentity: true,
  };
}