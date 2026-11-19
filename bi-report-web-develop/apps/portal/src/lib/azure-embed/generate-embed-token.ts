/**
 * Power BI embed tokens (PO_SPEND pattern):
 * MSAL client credentials → GenerateToken → retry with { username, roles, datasets }
 * and optional datasourceIdentities for cloud SQL SSO.
 */

import {
  buildRlsIdentities,
  needsEffectiveIdentity,
  needsWorkspaceIdentityError,
  RlsRolesRequiredError,
} from "./embed-rls";

export { RlsRolesRequiredError } from "./embed-rls";

export interface ServicePrincipalEmbedInput {
  workspaceId: string;
  reportId: string;
  datasetId?: string;
  /** Signed-in user email; sent as the effective identity username for RLS datasets. */
  username: string;
  roles?: string[];
  /** Portal says the report has RLS: send the identity with roles even if Power BI does not flag the dataset. */
  rlsEnabled?: boolean;
}

export interface ServicePrincipalEmbedResult {
  embedUrl: string;
  accessToken: string;
  reportId: string;
  expiration?: string;
}

type DatasetRlsFlags = {
  identityRequired: boolean;
  rolesRequired: boolean;
};

type PbiDatasource = {
  datasourceType?: string;
  connectionDetails?: Record<string, unknown>;
};

function pbiEnv() {
  const tenantId = process.env.SMART_PBI_TENANT_ID || process.env.PBI_TENANT_ID || process.env.MICROSOFT_TENANT_ID || "";
  const clientId =
    process.env.SMART_PBI_CLIENT_ID ||
    process.env.PBI_CLIENT_ID ||
    process.env.MICROSOFT_CLIENT_ID ||
    "";
  const clientSecret =
    process.env.SMART_PBI_CLIENT_SECRET || process.env.PBI_CLIENT_SECRET || process.env.MICROSOFT_CLIENT_SECRET || "";
  return { tenantId, clientId, clientSecret };
}

export function servicePrincipalConfigured(): boolean {
  const { tenantId, clientId, clientSecret } = pbiEnv();
  return Boolean(tenantId && clientId && clientSecret);
}

async function acquireToken(scope: string): Promise<string> {
  const { tenantId, clientId, clientSecret } = pbiEnv();
  if (!tenantId || !clientId || !clientSecret) {
    throw new Error("SMART_PBI_TENANT_ID, SMART_PBI_CLIENT_ID, and SMART_PBI_CLIENT_SECRET are required to embed with the service principal.");
  }
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    scope,
    grant_type: "client_credentials",
  });
  const response = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    cache: "no-store",
  });
  const data = (await response.json().catch(() => ({}))) as { access_token?: string; error_description?: string };
  if (!response.ok || !data.access_token) {
    throw new Error(data.error_description || "Could not acquire a Power BI token for the embed service principal.");
  }
  return data.access_token;
}

async function powerBiAccessToken(): Promise<string> {
  return acquireToken("https://analysis.windows.net/powerbi/api/.default");
}

export async function acquireDatabaseAccessToken(): Promise<string | undefined> {
  try {
    return await acquireToken("https://database.windows.net/.default");
  } catch {
    return undefined;
  }
}

export async function pbiFetch(
  token: string,
  path: string,
  init?: RequestInit,
): Promise<{ ok: boolean; status: number; text: string; json: Record<string, unknown> }> {
  const response = await fetch(`https://api.powerbi.com/v1.0/myorg${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });
  const text = await response.text();
  let json: Record<string, unknown> = {};
  try {
    json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    json = {};
  }
  return { ok: response.ok, status: response.status, text, json };
}

export async function resolvePowerBiDatasetId(
  workspaceId: string,
  reportId: string,
  hint?: string,
): Promise<string | undefined> {
  const token = await powerBiAccessToken();
  const report = await pbiFetch(token, `/groups/${workspaceId}/reports/${reportId}`);
  if (!report.ok) {
    return hint;
  }
  const fromApi = typeof report.json.datasetId === "string" ? report.json.datasetId : undefined;
  return hint || fromApi;
}

export async function resolveDatasetEmbedFlags(
  workspaceId: string,
  datasetId: string,
): Promise<DatasetRlsFlags> {
  if (!servicePrincipalConfigured()) {
    return { identityRequired: false, rolesRequired: false };
  }
  const token = await powerBiAccessToken();
  return fetchDatasetRlsFlags(token, workspaceId, datasetId);
}

async function fetchDatasetRlsFlags(
  token: string,
  workspaceId: string,
  datasetId: string,
): Promise<DatasetRlsFlags> {
  const res = await pbiFetch(token, `/groups/${workspaceId}/datasets/${datasetId}`);
  if (!res.ok) {
    return { identityRequired: false, rolesRequired: false };
  }
  return {
    identityRequired: res.json.isEffectiveIdentityRequired === true,
    rolesRequired: res.json.isEffectiveIdentityRolesRequired === true,
  };
}

async function fetchDatasetDatasources(token: string, workspaceId: string, datasetId: string): Promise<PbiDatasource[]> {
  const res = await pbiFetch(token, `/groups/${workspaceId}/datasets/${datasetId}/datasources`);
  if (!res.ok) return [];
  const value = res.json.value;
  return Array.isArray(value) ? (value as PbiDatasource[]) : [];
}

export function buildDatasourceIdentities(
  databaseToken: string | undefined,
  datasources: PbiDatasource[],
): Record<string, unknown>[] | undefined {
  if (!databaseToken || !datasources.length) return undefined;
  return [
    {
      identityBlob: databaseToken,
      datasources: datasources.map((ds) => ({
        datasourceType: ds.datasourceType ?? "Sql",
        connectionDetails: ds.connectionDetails ?? {},
      })),
    },
  ];
}

/** Best-effort only; Power BI lists object id, not app id — do not block embed on a false negative. */
export async function ensureServicePrincipalInWorkspace(_token: string, _workspaceId: string): Promise<void> {
  return;
}

async function tryGenerateTokenEndpoints(
  token: string,
  input: ServicePrincipalEmbedInput,
  datasetId: string | undefined,
  withIdentity: boolean,
  datasourceIdentities: Record<string, unknown>[] | undefined,
): Promise<{ ok: boolean; status: number; text: string; json: Record<string, unknown> }> {
  const roles = input.roles ?? [];
  const identities =
    withIdentity && datasetId ? buildRlsIdentities(input.username, roles, datasetId) : undefined;

  const endpoints: { path: string; body: Record<string, unknown> }[] = [];
  const v2: Record<string, unknown> = {
    reports: [{ id: input.reportId }],
    targetWorkspaces: [{ id: input.workspaceId }],
  };
  if (datasetId) v2.datasets = [{ id: datasetId }];
  if (identities) v2.identities = identities;
  if (datasourceIdentities?.length) v2.datasourceIdentities = datasourceIdentities;
  endpoints.push({ path: "/GenerateToken", body: v2 });

  const scoped: Record<string, unknown> = { accessLevel: "View" };
  if (datasetId) scoped.datasets = [{ id: datasetId }];
  if (identities) scoped.identities = identities;
  if (datasourceIdentities?.length) scoped.datasourceIdentities = datasourceIdentities;
  endpoints.push({
    path: `/groups/${input.workspaceId}/reports/${input.reportId}/GenerateToken`,
    body: scoped,
  });

  let last = { ok: false, status: 500, text: "", json: {} as Record<string, unknown> };
  for (const { path, body } of endpoints) {
    const result = await pbiFetch(token, path, { method: "POST", body: JSON.stringify(body) });
    if (result.ok) return result;
    last = result;
    if (!withIdentity && result.status === 400 && needsEffectiveIdentity(result.text)) {
      return result;
    }
  }
  return last;
}

export async function generateServicePrincipalEmbedToken(input: ServicePrincipalEmbedInput): Promise<ServicePrincipalEmbedResult> {
  const token = await powerBiAccessToken();

  const report = await pbiFetch(token, `/groups/${input.workspaceId}/reports/${input.reportId}`);
  if (!report.ok) {
    throw new Error(`Power BI could not read this report (${report.status}). Confirm the service principal is a member of the workspace.`);
  }
  const datasetId = input.datasetId || (typeof report.json.datasetId === "string" ? report.json.datasetId : undefined);
  const embedUrl =
    (typeof report.json.embedUrl === "string" && report.json.embedUrl) ||
    `https://app.powerbi.com/reportEmbed?reportId=${input.reportId}&groupId=${input.workspaceId}`;

  const roles = input.roles ?? [];
  let flags: DatasetRlsFlags = { identityRequired: false, rolesRequired: false };
  if (datasetId) {
    flags = await fetchDatasetRlsFlags(token, input.workspaceId, datasetId);
  }

  const identityMandatory = flags.identityRequired || flags.rolesRequired;

  let databaseToken: string | undefined;
  let datasources: PbiDatasource[] = [];
  if (datasetId) {
    datasources = await fetchDatasetDatasources(token, input.workspaceId, datasetId);
    if (datasources.length) {
      databaseToken = await acquireDatabaseAccessToken();
    }
  }
  const datasourceIdentities = buildDatasourceIdentities(databaseToken, datasources);

  let withIdentity = Boolean((identityMandatory || input.rlsEnabled) && roles.length);
  let lastError = "Power BI did not return an embed token.";

  for (let attempt = 0; attempt < 3; attempt++) {
    const dsForAttempt = withIdentity ? datasourceIdentities : undefined;
    const result = await tryGenerateTokenEndpoints(token, input, datasetId, withIdentity, dsForAttempt);
    if (result.ok && typeof result.json.token === "string") {
      return {
        embedUrl,
        accessToken: result.json.token,
        reportId: input.reportId,
        expiration: typeof result.json.expiration === "string" ? result.json.expiration : undefined,
      };
    }
    lastError = result.text.slice(0, 500) || lastError;

    if (needsWorkspaceIdentityError(result.text)) {
      if (withIdentity) {
        throw new Error("PREMIUM_ASWL workspace identity is required for this dataset.");
      }
      if (roles.length && datasetId) {
        withIdentity = true;
        continue;
      }
      throw new Error("PREMIUM_ASWL workspace identity is required for this dataset.");
    }

    if (!withIdentity && result.status === 400 && needsEffectiveIdentity(result.text)) {
      if (!roles.length) {
        throw new RlsRolesRequiredError();
      }
      if (!datasetId) {
        throw new Error("Could not resolve the Power BI dataset id for this report.");
      }
      withIdentity = true;
      continue;
    }
    break;
  }

  throw new Error(lastError);
}

/** Service principal token for Power BI REST (export, etc.). */
export async function acquirePowerBiServiceToken(): Promise<string> {
  return powerBiAccessToken();
}

export async function powerBiApiRequest(
  path: string,
  init?: RequestInit,
): Promise<{ ok: boolean; status: number; text: string; json: Record<string, unknown> }> {
  const token = await powerBiAccessToken();
  return pbiFetch(token, path, init);
}
