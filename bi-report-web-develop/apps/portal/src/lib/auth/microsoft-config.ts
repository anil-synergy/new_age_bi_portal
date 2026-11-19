const MICROSOFT_CLIENT_ID = process.env.NEXT_PUBLIC_MICROSOFT_CLIENT_ID ?? "";
const MICROSOFT_TENANT_ID = process.env.NEXT_PUBLIC_MICROSOFT_TENANT_ID ?? "";
const MICROSOFT_REDIRECT_URI =
  process.env.NEXT_PUBLIC_MICROSOFT_REDIRECT_URI ??
  (typeof window !== "undefined" ? `${window.location.origin}/auth/callback` : "");

export const microsoftAuthConfig = {
  clientId: MICROSOFT_CLIENT_ID,
  tenantId: MICROSOFT_TENANT_ID,
  redirectUri: MICROSOFT_REDIRECT_URI,
  authority: `https://login.microsoftonline.com/${MICROSOFT_TENANT_ID}`,
  scopes: ["openid", "profile", "email"],
};

export function validateMicrosoftConfig(): { valid: boolean; error?: string } {
  if (!microsoftAuthConfig.clientId) {
    return { valid: false, error: "NEXT_PUBLIC_MICROSOFT_CLIENT_ID is not configured." };
  }
  if (!microsoftAuthConfig.tenantId) {
    return { valid: false, error: "NEXT_PUBLIC_MICROSOFT_TENANT_ID is not configured." };
  }
  if (!microsoftAuthConfig.redirectUri) {
    return { valid: false, error: "NEXT_PUBLIC_MICROSOFT_REDIRECT_URI is not configured." };
  }
  return { valid: true };
}

/** Entra errors meaning "no usable session, the user has to interact". */
export const SSO_INTERACTION_ERRORS = new Set([
  "login_required",
  "interaction_required",
  "consent_required",
  "account_selection_required",
]);

export function buildMicrosoftAuthorizeUrl(options: { silent?: boolean; loginHint?: string } = {}): string {
  const validation = validateMicrosoftConfig();
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  const params = new URLSearchParams({
    client_id: microsoftAuthConfig.clientId,
    response_type: "code",
    scope: microsoftAuthConfig.scopes.join(" "),
    redirect_uri: microsoftAuthConfig.redirectUri,
    response_mode: "query",
    prompt: options.silent ? "none" : "select_account",
    state: Math.random().toString(36).substring(2),
  });
  if (options.loginHint) params.set("login_hint", options.loginHint);

  return `${microsoftAuthConfig.authority}/oauth2/v2.0/authorize?${params}`;
}

export interface SsoTokenResponse {
  accessToken: string;
  user: {
    email: string;
    upn: string;
    name?: string;
    loginType: "SSO";
    userId?: string;
  };
}

export async function exchangeCodeForToken(code: string): Promise<SsoTokenResponse> {
  const response = await fetch("/api/sso/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.message ?? data.error ?? `Failed to authenticate (${response.status})`);
  }
  return data as SsoTokenResponse;
}
