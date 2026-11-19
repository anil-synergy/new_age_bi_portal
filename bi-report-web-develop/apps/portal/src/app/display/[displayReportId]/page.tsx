"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import dynamic from "next/dynamic";
import { ProtectedRoute } from "@/modules/shared/components/auth/ProtectedRoute";
import { AppShell } from "@/modules/layout/components/AppShell";
import { Header } from "@/modules/layout/components/Header";
import { getDisplayReport } from "@/services/biServices";
import { usePortal } from "@/context/PortalContext";
import type { DisplayReport, EffectiveIdentity } from "@/types";
import { AILoadingAnimation } from "@/modules/loaders/components/AILoadingAnimation";

const DisplayReportViewer = dynamic(
  () => import("@/modules/tile-engine/components/DisplayReportViewer").then((m) => m.DisplayReportViewer),
  { ssr: false }
);

export default function DisplayReportPage() {
  const params = useParams();
  const displayReportId =
    typeof params.displayReportId === "string"
      ? params.displayReportId
      : params.displayReportId?.[0] ?? "";
  const { isSuperAdmin, userGroupIds, userId, userEmail, loadSemanticModel } = usePortal();
  const [displayReport, setDisplayReport] = useState<DisplayReport | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getDisplayReport(displayReportId)
      .then(setDisplayReport)
      .catch(() => setDisplayReport(null))
      .finally(() => setLoading(false));
    loadSemanticModel(displayReportId);
  }, [displayReportId, loadSemanticModel]);

  const effectiveIdentity: EffectiveIdentity | undefined = useMemo(() => {
    if (isSuperAdmin || !userEmail) return undefined;
    return { username: userEmail, roles: [] };
  }, [isSuperAdmin, userEmail]);

  return (
    <ProtectedRoute>
      <AppShell>
        <div className="relative h-full min-h-0">
          <Header title={displayReport?.name ?? "Display Report"} />
          <div className="absolute inset-x-0 bottom-0 top-11 min-h-0">
          {loading ? (
            <AILoadingAnimation stage="fetching-token" />
          ) : displayReport ? (
            <DisplayReportViewer
              displayReport={displayReport}
              effectiveIdentity={effectiveIdentity}
              isSuperAdmin={isSuperAdmin}
              userGroupIds={userGroupIds}
              userId={userId}
            />
          ) : (
            <div className="flex h-full items-center justify-center text-slate-500">Display report not found</div>
          )}
          </div>
        </div>
      </AppShell>
    </ProtectedRoute>
  );
}
