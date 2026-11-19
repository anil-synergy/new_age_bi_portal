import { NextResponse } from "next/server";
import { buildPortalSession } from "@/lib/auth/sso-server";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const code = typeof body?.code === "string" ? body.code.trim() : "";

    if (!code) {
      return NextResponse.json({ message: "Authorization code is required." }, { status: 400 });
    }

    const session = await buildPortalSession(code);
    return NextResponse.json(session);
  } catch (error) {
    const message = error instanceof Error ? error.message : "SSO authentication failed";
    return NextResponse.json({ message }, { status: 401 });
  }
}
