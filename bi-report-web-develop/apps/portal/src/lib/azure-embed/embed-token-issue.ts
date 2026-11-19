import type { EffectiveIdentity, EmbedTokenRequest, EmbedTokenResponse } from "@/types";
import { buildFunctionEffectiveIdentity, needsEffectiveIdentity } from "./embed-rls";
import { requestEmbedToken } from "./function-client";
import { servicePrincipalConfigured } from "./generate-embed-token";

export function azureFunctionEmbedConfigured(): boolean {
  return Boolean(
    process.env.AZURE_FUNCTION_BASE?.trim() || process.env.NEXT_PUBLIC_AZURE_FUNCTION_BASE?.trim(),
  );
}

export function embedPathsConfigured(): boolean {
  return azureFunctionEmbedConfigured() || servicePrincipalConfigured();
}

export type PortalEmbedTokenInput = {
  workspaceId: string;
  reportId: string;
  datasetId?: string;
  username: string;
  roles: string[];
  effectiveIdentity?: EffectiveIdentity;
  skipIdentity?: boolean;
  applyDatasourceIdentity?: boolean;
  embedType?: EmbedTokenRequest["embedType"];
  pageName?: string;
  visualName?: string;
  /** Fallback: retry with these roles if the first token request fails with an effective-identity error. */
  rlsRolesForIdentityRetry?: string[];
};

async function issuePortalEmbedTokenOnce(input: PortalEmbedTokenInput): Promise<EmbedTokenResponse> {
  const effectiveIdentity = input.skipIdentity === true ? undefined : input.effectiveIdentity;

  const roles = effectiveIdentity?.roles?.length ? effectiveIdentity.roles : input.roles;
  const skipIdentity = input.skipIdentity !== undefined ? input.skipIdentity : !effectiveIdentity;

  return requestEmbedToken({
    workspaceId: input.workspaceId,
    reportId: input.reportId,
    datasetId: input.datasetId,
    embedType: input.embedType ?? "report",
    pageName: input.pageName,
    visualName: input.visualName,
    username: input.username,
    roles,
    skipIdentity,
    effectiveIdentity,
    applyDatasourceIdentity: input.applyDatasourceIdentity,
  });
}

/** Single POST to BI_Portal_Auth with the portal-built payload (no contract rewrites). */
export async function requestPortalEmbedToken(input: PortalEmbedTokenInput): Promise<EmbedTokenResponse> {
  if (!azureFunctionEmbedConfigured()) {
    throw new Error("AZURE_FUNCTION_BASE is not configured.");
  }

  try {
    return await issuePortalEmbedTokenOnce(input);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    const retryRoles = input.rlsRolesForIdentityRetry ?? [];
    if (input.skipIdentity === true && retryRoles.length > 0 && needsEffectiveIdentity(msg)) {
      const effectiveIdentity = buildFunctionEffectiveIdentity(input.username, retryRoles, input.datasetId);
      return issuePortalEmbedTokenOnce({
        ...input,
        roles: retryRoles,
        skipIdentity: false,
        effectiveIdentity,
      });
    }
    throw error;
  }
}