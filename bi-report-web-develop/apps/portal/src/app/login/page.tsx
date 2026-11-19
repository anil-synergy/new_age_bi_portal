"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/modules/shared/providers/AuthProvider";
import { Button } from "@/modules/shared/components/ui/button";
import { BILoader } from "@/modules/loaders/components/BILoader";
import { validateMicrosoftConfig } from "@/lib/auth/microsoft-config";

type LoginMode = "checking" | "silent" | "interactive";

export default function LoginPage() {
  const auth = useAuth();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<LoginMode>("checking");

  useEffect(() => {
    if (auth.isAuthenticated()) {
      router.replace(auth.consumeReturnPath());
      return;
    }
    const interactive = new URLSearchParams(window.location.search).has("interactive");
    if (!interactive && auth.canTrySilentSignin() && validateMicrosoftConfig().valid) {
      setMode("silent");
      auth.signinRedirect({ silent: true });
      return;
    }
    setMode("interactive");
  }, [auth, router]);

  const handleMicrosoftSSO = () => {
    setError(null);
    const validation = validateMicrosoftConfig();
    if (!validation.valid) {
      setError(validation.error ?? "Microsoft SSO is not configured.");
      return;
    }
    try {
      setLoading(true);
      auth.signinRedirect();
    } catch (e) {
      setLoading(false);
      setError(e instanceof Error ? e.message : "Could not start Microsoft sign-in.");
    }
  };

  if (mode !== "interactive") {
    return <BILoader variant="fullscreen" label="Signing you in with Microsoft…" />;
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-br from-[#333869] to-slate-900 p-8">
      <div className="w-full max-w-md rounded-xl bg-white p-8 shadow-2xl">
        <h1 className="text-2xl font-bold text-[#333869]">Synergy BI Portal</h1>
        <p className="mt-2 text-slate-600">View all Power BI reports from one place</p>
        <p className="mt-3 text-xs text-slate-500">
          Sign in with your Synergy Microsoft account to load your report catalog.
        </p>
        {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
        <Button
          className="mt-8 w-full"
          size="lg"
          onClick={handleMicrosoftSSO}
          disabled={loading}
        >
          {loading ? "Redirecting…" : "Sign in with Microsoft"}
        </Button>
      </div>
    </div>
  );
}
