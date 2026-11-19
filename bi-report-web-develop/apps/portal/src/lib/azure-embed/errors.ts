const WORKSPACE_IDENTITY_HINT =
  "This report’s dataset uses Workspace Identity in Fabric/Power BI, but the workspace identity is missing, disabled, or the dataset owner cannot use it. " +
  "In the Fabric workspace: enable Workspace identity (Admin). Grant the dataset owner Contributor or higher on that workspace. " +
  "In dataset settings → Gateway and cloud connections, ensure the identity can reach the data source—or change the connection to OAuth, SQL credentials, or a service principal that is configured for embed.";

const PREMIUM_CAPACITY_HINT =
  "This report or dataset may require Premium or Fabric capacity (F64+), or the embed service account may lack access to the workspace. " +
  "Confirm the workspace is on Premium/Fabric capacity, add the Hawkeye service principal as Member (or Admin) on the workspace, and verify catalog workspace/report IDs.";

export const FUNCTION_APP_AUTH_HINT =
  "The Azure Function (BI_Portal_Auth) blocked this server request. Verify AZURE_FUNCTION_CODE (Function key for BI_Portal_Auth, not the host key unless intended). " +
  "Test: POST https://<app>.azurewebsites.net/api/BI_Portal_Auth?code=<key>. " +
  "Set the function to Allow anonymous (function key only) and disable App Service Authentication on this route. " +
  "If the Function App uses IP restrictions, allow the portal outbound IPs.";

export const FUNCTION_KEY_HINT =
  "The Azure Function rejected the function key (401). In the portal, set AZURE_FUNCTION_CODE to the BI_Portal_Auth function key and restart the app.";

function looksLikeJsonPayload(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return false;
  try {
    JSON.parse(trimmed);
    return true;
  } catch {
    return false;
  }
}

/** True when Easy Auth / IIS returns HTML instead of JSON from the Function App. */
export function isFunctionAppAuthBlocked(raw: string, status: number): boolean {
  if (looksLikeJsonPayload(raw)) return false;

  const lower = raw.toLowerCase();
  if (lower.includes("do not have permission to view this directory or page")) return true;
  if (lower.includes("invalid function key") || lower.includes("invalid authorization")) return false;

  if (lower.includes("<!doctype html") || lower.includes("<html")) {
    return (
      lower.includes("do not have permission") ||
      lower.includes("you do not have permission") ||
      lower.includes("log in") ||
      lower.includes("unauthorized")
    );
  }

  if (status === 401 || status === 403) {
    return (
      lower.includes("you do not have permission") ||
      lower.includes("log in") ||
      (lower.length > 0 && lower.length < 80 && !lower.includes("success"))
    );
  }

  return false;
}

export function isFunctionKeyRejected(raw: string, status: number): boolean {
  if (status !== 401 && status !== 403) return false;
  if (looksLikeJsonPayload(raw)) {
    const data = JSON.parse(raw) as Record<string, unknown>;
    const msg = String(data.message ?? data.error ?? "").toLowerCase();
    return msg.includes("key") || msg.includes("authorization") || msg.includes("unauthorized");
  }
  const lower = raw.toLowerCase();
  return lower.includes("invalid function key") || lower.includes("invalid authorization");
}

export function classifyFunctionHttpResponse(raw: string, status: number) {
  return {
    status,
    looksJson: looksLikeJsonPayload(raw),
    authBlocked: isFunctionAppAuthBlocked(raw, status),
    keyRejected: isFunctionKeyRejected(raw, status),
    snippet: raw.slice(0, 120).replace(/\s+/g, " "),
  };
}

export function formatFunctionAppAuthError(_raw: string): string {
  return FUNCTION_APP_AUTH_HINT;
}

/** Power BI embed SDK often returns only a requestId in technicalDetails for gateway failures. */
export function extractPowerBiRequestId(technicalDetails: unknown): string | null {
  if (!technicalDetails) return null;
  if (typeof technicalDetails === "object" && technicalDetails !== null && "requestId" in technicalDetails) {
    const id = String((technicalDetails as { requestId: unknown }).requestId).trim();
    return id.length > 0 ? id : null;
  }
  if (typeof technicalDetails === "string") {
    try {
      const parsed = JSON.parse(technicalDetails) as { requestId?: unknown };
      if (parsed?.requestId != null) return String(parsed.requestId).trim() || null;
    } catch {
      /* ignore */
    }
  }
  return null;
}

/** Map raw Power BI / Azure Function errors to actionable portal text. */
export function formatEmbedUserMessage(raw: string): string {
  const text = raw.trim();
  const upper = text.toUpperCase();

  if (text.includes(FUNCTION_APP_AUTH_HINT)) {
    return FUNCTION_APP_AUTH_HINT;
  }
  if (text.toLowerCase().includes("you do not have permission to view this directory or page")) {
    return FUNCTION_APP_AUTH_HINT;
  }

  if (text.includes("RLS identity although roles are mapped") || text.includes("without RLS identity")) {
    return text;
  }
  if (upper.includes("PREMIUM_ASWL_ERROR") || upper.includes("PREMIUM_ASWL")) {
    if (text.toLowerCase().includes("on premise service issue") || text.toLowerCase().includes("on-premise")) {
      return (
        "Power BI could not reach the on-premises data source for this report (gateway or SQL connection). " +
        "Check the dataset gateway status, credentials, and that the Hawkeye service principal can use the connection for embed. " +
        "For DirectQuery/live gateway SSO, set PBI_DATASOURCE_SCOPE on BI_Portal_Auth (see apps/portal/docs/d360-pbi-embed.md). " +
        "Embed token was issued successfully; the failure is at data refresh/query time in Power BI."
      );
    }
    return WORKSPACE_IDENTITY_HINT;
  }
  if (upper.includes("WORKSPACE IDENTITY")) {
    return WORKSPACE_IDENTITY_HINT;
  }
  if (upper.includes("POWERBICAPACITYNOTFOUND") || upper.includes("NOTINPREMIUMCAPACITY")) {
    return PREMIUM_CAPACITY_HINT;
  }
  if (upper.includes("POWERBIENTITYNOTFOUND")) {
    return (
      "This catalog id is not a Power BI report in the workspace (or the embed service principal cannot see it). " +
      "Fabric Rayfin apps are not embedded via BI_Portal_Auth — open them from the menu so the portal uses MSAL and hosting_url from bi_fabric_apps."
    );
  }
  if (
    text.includes("Fabric Rayfin app") ||
    text.includes("delegated Entra (MSAL)") ||
    text.includes("BI_Portal_Auth supports Power BI reports only")
  ) {
    return text;
  }
  if (text.toLowerCase().includes("requires effective identity")) {
    return "Row-level security is enabled on this dataset but no user identity was sent. Check RLS roles on the report in Administration and that you are signed in with the expected email.";
  }
  if (text.toLowerCase().includes("reshare")) {
    return "The Power BI service account used by BI_Portal_Auth does not have reshare (build) permission on this workspace.";
  }
  return text;
}

function nonEmptyDetail(value: string | undefined): string | undefined {
  const t = value?.trim();
  return t ? t : undefined;
}

/** Never return blank text for 502 responses (empty Function `message` fields). */
export function ensureEmbedUserMessage(raw: string, fallback: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return fallback;
  const formatted = formatEmbedUserMessage(trimmed);
  const out = formatted.trim();
  if (!out) return fallback;
  if (/^\{\s*"message"\s*:\s*""\s*\}$/.test(out)) return fallback;
  return out;
}

export function describeEmbedError(data: Record<string, unknown>, raw: string): string {
  const err = data.error as Record<string, unknown> | string | undefined;
  const nested =
    (typeof err === "object" && err ? (err.error as Record<string, unknown> | undefined) : undefined) ??
    (typeof err === "object" ? err : undefined);
  const code =
    nonEmptyDetail(typeof nested?.code === "string" ? nested.code : undefined) ??
    nonEmptyDetail(typeof data.code === "string" ? data.code : undefined);
  const nestedMessage = nonEmptyDetail(typeof nested?.message === "string" ? nested.message : undefined);
  const topMessage = nonEmptyDetail(typeof data.message === "string" ? data.message : undefined);
  let detail =
    nestedMessage ??
    topMessage ??
    nonEmptyDetail(typeof err === "string" ? err : undefined) ??
    (typeof err === "object" && err
      ? nonEmptyDetail(typeof err.message === "string" ? err.message : undefined)
      : undefined);

  if (!detail && typeof err === "object" && err) {
    try {
      const serialized = JSON.stringify(err);
      if (serialized && serialized !== "{}" && serialized.length < 500) {
        detail = serialized;
      }
    } catch {
      /* ignore */
    }
  }

  if (code === "PowerBIEntityNotFound") {
    return formatEmbedUserMessage("PowerBIEntityNotFound");
  }
  if (detail?.toLowerCase().includes("requires effective identity")) {
    return formatEmbedUserMessage(detail);
  }
  if (detail?.toLowerCase().includes("reshare permissions")) {
    return formatEmbedUserMessage(detail);
  }
  const rawSnip = nonEmptyDetail(raw.slice(0, 300));
  const combined =
    code && detail ? `${code}: ${detail}` : detail ?? code ?? rawSnip ?? "Failed to fetch embed token";
  return formatEmbedUserMessage(combined);
}
