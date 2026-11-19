"use client";

import { useEffect, useState } from "react";
import { AILoadingAnimation } from "@/modules/loaders/components/AILoadingAnimation";
import { getRayfinConfig, missingRayfinAuthConfig } from "./config";
import { getRayfinMsal } from "./msal";

/**
 * Entra SPA redirect URI is often the bare origin (e.g. http://localhost:3000).
 * Completes the MSAL redirect here before the root page sends the user to /dashboard.
 */
export function RayfinMsalRedirectLanding() {
  const [message, setMessage] = useState("Completing Microsoft sign-in for Fabric Rayfin…");

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const config = getRayfinConfig();
        const missing = missingRayfinAuthConfig(config);
        if (missing.length > 0) {
          if (active) setMessage(`Rayfin is not configured (${missing.join(", ")}).`);
          return;
        }
        await getRayfinMsal(config);
        if (!active) return;
        setMessage("Redirecting to your report…");
      } catch (error) {
        if (active) {
          setMessage(
            error instanceof Error
              ? `Fabric sign-in could not finish: ${error.message}`
              : "Fabric sign-in could not finish.",
          );
        }
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50">
      <div className="w-full max-w-md px-4">
        <AILoadingAnimation stage="fetching-token" message={message} />
      </div>
    </main>
  );
}