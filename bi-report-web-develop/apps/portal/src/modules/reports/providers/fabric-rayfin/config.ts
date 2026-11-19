// Next.js only inlines NEXT_PUBLIC_* values referenced literally, so each one is read by name.
const RAW = {
  tenantId: process.env.NEXT_PUBLIC_RAYFIN_TENANT_ID || process.env.NEXT_PUBLIC_MICROSOFT_TENANT_ID || "",
  clientId: process.env.NEXT_PUBLIC_RAYFIN_CLIENT_ID ?? "",
  redirectUri: process.env.NEXT_PUBLIC_RAYFIN_REDIRECT_URI ?? "",
  scopes: process.env.NEXT_PUBLIC_RAYFIN_SCOPES ?? "",
  workspaceId: process.env.NEXT_PUBLIC_RAYFIN_WORKSPACE_ID ?? "",
  appId: process.env.NEXT_PUBLIC_RAYFIN_APP_ID ?? "",
  appUrl: process.env.NEXT_PUBLIC_RAYFIN_APP_URL ?? "",
};

export const RAYFIN_ROUTE = "/dashboard/apps/fabric-rayfin";

export interface RayfinConfig {
  tenantId: string;
  clientId: string;
  redirectUri: string;
  scopes: string[];
  workspaceId: string;
  appId: string;
  appUrl: string;
  /** Origin of `appUrl`, or "" when the URL is not a valid absolute http(s) URL. */
  appOrigin: string;
}

function originOf(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.origin : "";
  } catch {
    return "";
  }
}

/** Browser only: defaults to bare origin (matches rayfin_embed_test and typical Entra SPA registration). */
export function getRayfinConfig(): RayfinConfig {
  return getRayfinConfigForApp({});
}

export type RayfinAppOverrides = {
  appUrl?: string;
  workspaceId?: string;
  appId?: string;
};

export type RayfinConfigBuildOptions = {
  /** When true, do not fall back to NEXT_PUBLIC_RAYFIN_* app URL/IDs (menu catalog apps). */
  fromCatalogOnly?: boolean;
};

/** Normalize to Entra-friendly SPA redirect (origin-only when path is `/`). */
export function normalizeRayfinRedirectUri(uri: string): string {
  const trimmed = uri.trim();
  if (!trimmed) return "";
  try {
    const url = new URL(trimmed);
    if (!url.pathname || url.pathname === "/") return url.origin;
    const path = url.pathname.replace(/\/$/, "") || "/";
    return `${url.origin}${path === "/" ? "" : path}`;
  } catch {
    return trimmed.replace(/\/$/, "");
  }
}

/**
 * Env override, else `${origin}/dashboard/apps/fabric-rayfin` (portal MSAL landing route).
 * Use bare origin only if that exact URI is registered in Entra (see HomeRouter for `/` callbacks).
 */
export function resolveRayfinRedirectUri(explicit: string): string {
  const fromEnv = normalizeRayfinRedirectUri(explicit);
  if (fromEnv) return fromEnv;
  if (typeof window !== "undefined") return `${window.location.origin}${RAYFIN_ROUTE}`;
  return "";
}

/** Entra AADSTS50011 — redirect sent in authorize request is not on the app registration. */
export function isEntraRedirectMismatchError(message: string): boolean {
  return /AADSTS50011/i.test(message) || /redirect URI.*does not match/i.test(message);
}

export function getRayfinConfigForApp(overrides: RayfinAppOverrides, options?: RayfinConfigBuildOptions): RayfinConfig {
  const catalogOnly = options?.fromCatalogOnly === true;
  const appUrl = (catalogOnly ? overrides.appUrl ?? "" : overrides.appUrl ?? RAW.appUrl).trim();
  return {
    tenantId: RAW.tenantId.trim(),
    clientId: RAW.clientId.trim(),
    redirectUri: resolveRayfinRedirectUri(RAW.redirectUri),
    scopes: RAW.scopes.split(/\s+/).filter(Boolean),
    workspaceId: (catalogOnly ? overrides.workspaceId ?? "" : overrides.workspaceId ?? RAW.workspaceId).trim(),
    appId: (catalogOnly ? overrides.appId ?? "" : overrides.appId ?? RAW.appId).trim(),
    appUrl,
    appOrigin: originOf(appUrl),
  };
}

/** Sign-in settings shared by every Rayfin app in this deployment. */
export function missingRayfinAuthConfig(config: RayfinConfig): string[] {
  const missing: string[] = [];
  if (!config.tenantId) missing.push("NEXT_PUBLIC_RAYFIN_TENANT_ID");
  if (!config.clientId) missing.push("NEXT_PUBLIC_RAYFIN_CLIENT_ID");
  if (config.scopes.length === 0) missing.push("NEXT_PUBLIC_RAYFIN_SCOPES");
  return missing;
}

export type RayfinConfigValidateOptions = {
  requireCatalogAppUrl?: boolean;
};

export function missingRayfinConfig(config: RayfinConfig, options?: RayfinConfigValidateOptions): string[] {
  const missing = missingRayfinAuthConfig(config);
  const urlLabel = options?.requireCatalogAppUrl
    ? "catalog hosting URL (bi_fabric_apps.hosting_url)"
    : "NEXT_PUBLIC_RAYFIN_APP_URL";
  if (!config.appUrl) missing.push(urlLabel);
  else if (!config.appOrigin) missing.push(`${urlLabel} (not a valid http(s) URL)`);
  return missing;
}
