import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { upnToEmail, type MicrosoftIdClaims } from "./user-identity";

function getSsoEnv() {
  const tenantId = process.env.MICROSOFT_TENANT_ID;
  const clientId = process.env.MICROSOFT_CLIENT_ID;
  const clientSecret = process.env.MICROSOFT_CLIENT_SECRET;
  const redirectUri = process.env.MICROSOFT_REDIRECT_URI;
  const jwtSecret = process.env.JWT_SECRET;

  if (!tenantId || !clientId || !clientSecret || !redirectUri || !jwtSecret) {
    throw new Error("SSO server configuration is incomplete.");
  }

  return {
    tenantId,
    clientId,
    clientSecret,
    redirectUri,
    jwtSecret,
    jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? "8h",
    ssoSessionTimeoutHours: Number(process.env.SSO_SESSION_TIMEOUT_HOURS ?? "8"),
  };
}

export interface MicrosoftTokenResponse {
  id_token: string;
  access_token?: string;
  token_type?: string;
  expires_in?: number;
}

export async function exchangeAuthorizationCode(code: string): Promise<MicrosoftTokenResponse> {
  const { tenantId, clientId, clientSecret, redirectUri } = getSsoEnv();

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
    scope: "openid profile email",
  });

  const response = await fetch(
    `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    }
  );

  const data = (await response.json()) as MicrosoftTokenResponse & {
    error?: string;
    error_description?: string;
  };

  if (!response.ok || !data.id_token) {
    throw new Error(data.error_description ?? data.error ?? "Microsoft token exchange failed");
  }

  return data;
}

export async function verifyMicrosoftIdToken(idToken: string): Promise<JWTPayload & MicrosoftIdClaims> {
  const { tenantId, clientId } = getSsoEnv();
  const jwks = createRemoteJWKSet(
    new URL(`https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys`)
  );

  const { payload } = await jwtVerify(idToken, jwks, {
    issuer: `https://login.microsoftonline.com/${tenantId}/v2.0`,
    audience: clientId,
  });

  return payload as JWTPayload & MicrosoftIdClaims;
}

export function selectApiBearerToken(ms: MicrosoftTokenResponse): string {
  const access = ms.access_token;
  if (access) {
    try {
      const [, payload] = access.split(".");
      const json = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { aud?: string | string[] };
      const aud = Array.isArray(json.aud) ? json.aud.join(" ") : json.aud ?? "";
      const isGraph = aud.includes("00000003-0000-0000-c000-000000000000") || aud.includes("graph.microsoft.com");
      if (!isGraph) return access;
    } catch {
      return access;
    }
  }
  return ms.id_token;
}

export async function buildPortalSession(code: string) {
  const tokenResponse = await exchangeAuthorizationCode(code);
  const claims = await verifyMicrosoftIdToken(tokenResponse.id_token);
  const email = upnToEmail(claims);
  if (!email) {
    throw new Error("Could not resolve user email from Microsoft identity.");
  }
  const upn = claims.preferred_username?.trim() || claims.upn?.trim() || email;
  const userId = claims.sub ?? email;
  const accessToken = selectApiBearerToken(tokenResponse);

  return {
    accessToken,
    user: {
      email,
      upn,
      name: claims.name,
      loginType: "SSO" as const,
      userId,
    },
  };
}

export function getSsoSessionTimeoutMs(): number {
  const hours = Number(process.env.SSO_SESSION_TIMEOUT_HOURS ?? "8");
  return hours * 60 * 60 * 1000;
}
