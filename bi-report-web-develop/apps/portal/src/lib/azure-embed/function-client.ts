import type { EmbedTokenRequest, EmbedTokenResponse, PageMeta } from "@/types";
import {
  describeEmbedError,
  formatFunctionAppAuthError,
  FUNCTION_KEY_HINT,
  isFunctionAppAuthBlocked,
  isFunctionKeyRejected,
} from "./errors";
import { isRealGuid } from "./ids";

/** Hawkeye HTTP trigger for Power BI embed tokens (replaces legacy D360_PBI_Embed). */
export const BI_PORTAL_AUTH_FUNCTION = "BI_Portal_Auth";

function embedFunctionPath(): string {
  const fromEnv = process.env.AZURE_EMBED_FUNCTION_PATH?.trim();
  return fromEnv || BI_PORTAL_AUTH_FUNCTION;
}

function azureFunctionBase(): string {
  const base = (
    process.env.AZURE_FUNCTION_BASE ||
    process.env.NEXT_PUBLIC_AZURE_FUNCTION_BASE ||
    ""
  ).replace(/\/$/, "");
  if (!base) {
    throw new Error("AZURE_FUNCTION_BASE is not configured.");
  }
  return base;
}

function azureFunctionUrl(path: string): string {
  const url = `${azureFunctionBase()}/${path.replace(/^\//, "")}`;
  const code = process.env.AZURE_FUNCTION_CODE?.trim();
  if (!code) return url;
  const joiner = url.includes("?") ? "&" : "?";
  return `${url}${joiner}code=${encodeURIComponent(code)}`;
}

/** Body contract for BI_Portal_Auth (portal server → Function). */
export function buildD360EmbedBody(request: EmbedTokenRequest): Record<string, unknown> {
  const body: Record<string, unknown> = {
    workspaceId: request.workspaceId,
    reportId: request.reportId,
  };
  if (request.datasetId && isRealGuid(request.datasetId)) {
    body.datasetId = request.datasetId;
  }

  const username = request.username?.trim() || request.effectiveIdentity?.username?.trim();
  const roles =
    request.roles?.map((r) => r.trim()).filter(Boolean) ??
    request.effectiveIdentity?.roles?.map((r) => r.trim()).filter(Boolean) ??
    [];
  const hasUsername = Boolean(username);
  const skipIdentity =
    request.skipIdentity !== undefined
      ? request.skipIdentity
      : !request.effectiveIdentity && !hasUsername;

  if (username) body.username = username;
  body.roles = roles;
  body.skipIdentity = skipIdentity;

  if (request.effectiveIdentity && skipIdentity !== true) {
    body.effectiveIdentity = request.effectiveIdentity;
  }
  if (request.applyDatasourceIdentity === true) {
    body.applyDatasourceIdentity = true;
  }

  return body;
}

async function postJson(path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const response = await fetch(azureFunctionUrl(path), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  const raw = await response.text();

  if (isFunctionKeyRejected(raw, response.status)) {
    throw new Error(FUNCTION_KEY_HINT);
  }

  if (isFunctionAppAuthBlocked(raw, response.status)) {
    throw new Error(formatFunctionAppAuthError(raw));
  }

  let data: Record<string, unknown> = {};
  try {
    data = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  } catch {
    throw new Error(
      isFunctionAppAuthBlocked(raw, response.status)
        ? formatFunctionAppAuthError(raw)
        : raw.slice(0, 300) || "Azure Function returned a non-JSON payload.",
    );
  }
  if (!response.ok || data.success === false) {
    throw new Error(describeEmbedError(data, raw));
  }

  return data;
}

async function getJson(path: string, params: Record<string, string>): Promise<Record<string, unknown>> {
  const search = new URLSearchParams(params);
  const response = await fetch(azureFunctionUrl(`${path}?${search}`), {
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  const raw = await response.text();

  if (isFunctionAppAuthBlocked(raw, response.status)) {
    throw new Error(formatFunctionAppAuthError(raw));
  }

  let data: Record<string, unknown> = {};
  try {
    data = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  } catch {
    throw new Error(
      isFunctionAppAuthBlocked(raw, response.status)
        ? formatFunctionAppAuthError(raw)
        : raw.slice(0, 300) || "Azure Function returned a non-JSON payload.",
    );
  }
  if (!response.ok || data.success === false) {
    throw new Error(describeEmbedError(data, raw));
  }
  return data;
}

/**
 * Ask the Hawkeye Azure Function for a Power BI embed token.
 * Runs only on the server so the function URL / code never ships to the browser.
 */
export async function requestEmbedToken(request: EmbedTokenRequest): Promise<EmbedTokenResponse> {
  if (!isRealGuid(request.workspaceId) || !isRealGuid(request.reportId)) {
    throw new Error("A valid Power BI workspace ID and report ID are required to embed.");
  }

  const fnBody = buildD360EmbedBody(request);
  const data = await postJson(embedFunctionPath(), fnBody);
  const embedUrl = (data.embedUrl ?? data.embeddedUrl) as string | undefined;
  const accessToken = (data.embedToken ?? data.accessToken ?? data.token) as string | undefined;
  const securityRaw = data.security as Record<string, unknown> | undefined;
  const security =
    securityRaw && typeof securityRaw === "object"
      ? {
          rlsApplied: securityRaw.rlsApplied === true,
          datasourceOnly: securityRaw.datasourceOnly === true,
          roles: Array.isArray(securityRaw.roles)
            ? (securityRaw.roles as string[]).map(String).filter(Boolean)
            : undefined,
        }
      : undefined;

  return {
    embedUrl: embedUrl ?? "",
    accessToken: accessToken ?? "",
    reportId: typeof data.reportId === "string" && isRealGuid(data.reportId) ? data.reportId : request.reportId,
    expiration: typeof data.expiration === "string" ? data.expiration : undefined,
    enablePagination: data.enablePagination as boolean | undefined,
    pages: data.pages as PageMeta[] | undefined,
    security,
  };
}

export async function requestReportPages(workspaceId: string, reportId: string): Promise<PageMeta[]> {
  const data = await getJson("D360_PBI_Pages", { workspaceId, reportId });
  return (data.pages ?? data) as PageMeta[];
}

export async function requestSemanticModel(workspaceId: string, reportId: string, datasetId?: string) {
  const params: Record<string, string> = { workspaceId, reportId };
  if (datasetId) params.datasetId = datasetId;
  const data = await getJson("D360_PBI_SemanticModel", params);
  return data.model ?? data;
}

export async function requestDaxQuery(
  workspaceId: string,
  datasetId: string,
  daxQuery: string,
  effectiveIdentity?: { username: string; roles: string[] },
) {
  const data = await postJson("D360_PBI_ExecuteDax", {
    workspaceId,
    datasetId,
    daxQuery,
    effectiveIdentity,
  });
  return data.results ?? data;
}
