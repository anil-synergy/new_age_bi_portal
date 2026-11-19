import { NextResponse } from "next/server";
import { jwtVerify, createRemoteJWKSet } from "jose";

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (!token) {
    return NextResponse.json({ active: false }, { status: 401 });
  }

  const tenantId = process.env.MICROSOFT_TENANT_ID;
  const clientId = process.env.MICROSOFT_CLIENT_ID;
  if (!tenantId || !clientId) {
    return NextResponse.json({ message: "SSO not configured" }, { status: 500 });
  }

  try {
    const jwks = createRemoteJWKSet(
      new URL(`https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys`)
    );
    const { payload } = await jwtVerify(token, jwks, {
      issuer: `https://login.microsoftonline.com/${tenantId}/v2.0`,
    });

    return NextResponse.json({
      active: true,
      loginType: "SSO",
      email: payload.preferred_username ?? payload.email ?? null,
      upn: payload.upn ?? payload.preferred_username ?? null,
      expiresAt: payload.exp ?? null,
    });
  } catch {
    return NextResponse.json({ active: false }, { status: 401 });
  }
}
