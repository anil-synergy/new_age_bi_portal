import { createRemoteJWKSet, jwtVerify } from "jose";
import { upnToEmail } from "@/lib/auth/user-identity";

export async function emailFromBearer(authorization: string | null): Promise<string | null> {
  if (!authorization?.startsWith("Bearer ")) return null;
  const token = authorization.slice(7);
  const tenantId = process.env.MICROSOFT_TENANT_ID || process.env.NEXT_PUBLIC_MICROSOFT_TENANT_ID;
  const clientId = process.env.MICROSOFT_CLIENT_ID || process.env.NEXT_PUBLIC_MICROSOFT_CLIENT_ID;
  if (!tenantId || !clientId) return null;

  const jwks = createRemoteJWKSet(
    new URL(`https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys`)
  );

  let payload;
  try {
    ({ payload } = await jwtVerify(token, jwks, {
      issuer: `https://login.microsoftonline.com/${tenantId}/v2.0`,
      audience: clientId,
    }));
  } catch (error) {
    // A rejected token means "not signed in" (401), not a server failure. Log the reason only, never the token.
    const err = error as Error & { code?: string };
    console.warn(`[auth] bearer token rejected: ${err.code ?? err.name}: ${err.message}`);
    return null;
  }

  return upnToEmail({
    preferred_username: typeof payload.preferred_username === "string" ? payload.preferred_username : undefined,
    upn: typeof payload.upn === "string" ? payload.upn : undefined,
    email: typeof payload.email === "string" ? payload.email : undefined,
  });
}
