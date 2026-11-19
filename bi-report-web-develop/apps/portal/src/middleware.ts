import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const authEnabled = process.env.NEXT_PUBLIC_AUTH_ENABLED === "true";

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/api") ||
    pathname.includes(".")
  ) {
    return NextResponse.next();
  }

  // No-login mode: only skip silent-renew callback; allow /authentication/callback for optional sign-in
  if (!authEnabled && pathname.startsWith("/authentication/silent_callback")) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
