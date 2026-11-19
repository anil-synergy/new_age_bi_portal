"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { ProtectedRoute } from "@/modules/shared/components/auth/ProtectedRoute";
import { AppShell } from "@/modules/layout/components/AppShell";
import { usePortal } from "@/context/PortalContext";
import { canConfigurePortal } from "@/lib/auth/portal-access";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { isSuperAdmin, isDepAdmin, isLoading, userInfo } = usePortal();
  const router = useRouter();
  const allowed = canConfigurePortal(userInfo, { isSuperAdmin, isDepAdmin });

  useEffect(() => {
    if (!isLoading && !allowed) {
      router.replace("/access-denied");
    }
  }, [isLoading, allowed, router]);

  return (
    <ProtectedRoute>
      <AppShell>{children}</AppShell>
    </ProtectedRoute>
  );
}
