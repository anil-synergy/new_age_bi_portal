"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/modules/shared/providers/AuthProvider";
import { exchangeCodeForToken, SSO_INTERACTION_ERRORS, type SsoTokenResponse } from "@/lib/auth/microsoft-config";
import { BILoader } from "@/modules/loaders/components/BILoader";

// Microsoft authorization codes share a long common prefix, so a short key
// made every new login look like the previous one and skipped the exchange.
const exchanges = new Map<string, Promise<SsoTokenResponse>>();

function exchangeOnce(code: string) {
  const existing = exchanges.get(code);
  if (existing) return existing;
  const pending = exchangeCodeForToken(code);
  exchanges.set(code, pending);
  return pending;
}

export function AuthCallbackContent() {
  const auth = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("Completing sign in…");

  useEffect(() => {
    let active = true;
    const msError = searchParams.get("error");
    const msErrorDesc = searchParams.get("error_description");
    if (msError) {
      if (SSO_INTERACTION_ERRORS.has(msError)) {
        router.replace("/login?interactive=1");
        return;
      }
      setError(msErrorDesc ?? msError);
      return;
    }

    const code = searchParams.get("code");
    if (!code) {
      setError("No authorization code received from Microsoft.");
      return;
    }

    if (auth.isAuthenticated()) {
      router.replace(auth.consumeReturnPath());
      return;
    }

    setStatus("Signing you in…");
    exchangeOnce(code)
      .then(({ accessToken, user }) => {
        auth.persistSession(accessToken, {
          email: user.email,
          upn: user.upn,
          name: user.name,
          loginType: "SSO",
          userId: user.userId,
        });
        if (active) router.replace(auth.consumeReturnPath());
      })
      .catch((e: Error) => {
        if (active) setError(e.message ?? "Sign-in failed.");
      });

    return () => {
      active = false;
    };
  }, [auth, router, searchParams]);

  if (error) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4 p-8">
        <p className="text-center text-red-600">{error}</p>
        <button
          type="button"
          className="rounded bg-primary px-4 py-2 text-white"
          onClick={() => router.replace("/login")}
        >
          Back to login
        </button>
      </div>
    );
  }

  return <BILoader variant="fullscreen" label={status} />;
}
