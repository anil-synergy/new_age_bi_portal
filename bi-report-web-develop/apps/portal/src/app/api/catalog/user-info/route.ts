import { NextRequest, NextResponse } from "next/server";
import { emailFromBearer } from "@/lib/catalog/entra-user";
import { loadUserInfoForUser } from "@/lib/catalog/fetch-reports";

export async function GET(request: NextRequest) {
  try {
    const authorization = request.headers.get("authorization");
    const email = await emailFromBearer(authorization);
    if (!email || !authorization) {
      return NextResponse.json({ message: "Sign in required" }, { status: 401 });
    }

    const userInfo = await loadUserInfoForUser(authorization, email);
    return NextResponse.json(userInfo);
  } catch (error) {
    const err = error as Error & { code?: string };
    return NextResponse.json(
      {
        message: "Could not load user profile from the database.",
        detail: process.env.NODE_ENV === "development" ? err.message : undefined,
        code: err.code,
      },
      { status: 500 }
    );
  }
}
