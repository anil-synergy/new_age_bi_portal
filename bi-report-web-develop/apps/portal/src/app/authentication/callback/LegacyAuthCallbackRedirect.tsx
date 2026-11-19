"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";

/** Legacy OIDC callback path — forward query string to /auth/callback */
export function LegacyAuthCallbackRedirect() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const query = searchParams.toString();
    router.replace(query ? `/auth/callback?${query}` : "/auth/callback");
  }, [router, searchParams]);

  return null;
}
