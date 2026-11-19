"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "../../providers/AuthProvider";
import { BILoader } from "@/modules/loaders/components/BILoader";
import { isAuthEnabled } from "@/lib/config";
import { validateMicrosoftConfig } from "@/lib/auth/microsoft-config";

type GateState = "checking" | "allowed" | "denied";

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const auth = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const authOn = isAuthEnabled();
  const [gate, setGate] = useState<GateState>(() => (authOn ? "checking" : "allowed"));

  useEffect(() => {
    if (!authOn || auth.isAuthenticated()) {
      setGate("allowed");
      return;
    }

    setGate("denied");
    // Go straight to Entra with prompt=none; an active Microsoft session skips the login page.
    if (auth.canTrySilentSignin() && validateMicrosoftConfig().valid) {
      auth.signinRedirect({ silent: true, returnTo: pathname });
    } else {
      localStorage.setItem("redirectUri", pathname);
      router.replace("/login?interactive=1");
    }
  }, [auth, authOn, router, pathname]);

  if (!authOn || gate === "allowed") {
    return <>{children}</>;
  }

  return (
    <BILoader
      variant="fullscreen"
      label={gate === "checking" ? "Checking session…" : "Signing you in with Microsoft…"}
    />
  );
}
