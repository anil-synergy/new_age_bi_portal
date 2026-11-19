"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AILoadingAnimation } from "@/modules/loaders/components/AILoadingAnimation";
import { RayfinMsalRedirectLanding } from "@/modules/reports/providers/fabric-rayfin/RayfinMsalRedirectLanding";
import { hasRayfinMsalCallbackInUrl } from "@/modules/reports/providers/fabric-rayfin/rayfin-msal-callback";
/**
 * Next.js server `redirect()` on `/` runs before the browser can read `?code=` (and returns 307),
 * so MSAL callbacks for a bare-origin redirect URI must be handled on the client here.
 */
export function HomeRouter() {
  const router = useRouter();
  const [view, setView] = useState<"pending" | "msal">("pending");

  useEffect(() => {
    const search = typeof window !== "undefined" ? window.location.search : "";

    if (hasRayfinMsalCallbackInUrl(search)) {
      setView("msal");
      return;
    }
    const authEnabled = process.env.NEXT_PUBLIC_AUTH_ENABLED === "true";
    router.replace(authEnabled ? "/login" : "/dashboard");
  }, [router]);

  if (view === "msal") return <RayfinMsalRedirectLanding />;
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50">
      <AILoadingAnimation stage="fetching-token" message="Loading portal…" />
    </main>
  );
}