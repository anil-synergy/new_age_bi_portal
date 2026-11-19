"use client";

import { ProtectedRoute } from "@/modules/shared/components/auth/ProtectedRoute";
import { AppShell } from "@/modules/layout/components/AppShell";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <ProtectedRoute>
      <AppShell>{children}</AppShell>
    </ProtectedRoute>
  );
}
