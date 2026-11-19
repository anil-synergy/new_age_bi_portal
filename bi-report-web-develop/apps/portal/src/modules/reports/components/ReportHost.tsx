"use client";

import type { ComponentType } from "react";
import dynamic from "next/dynamic";
import { AILoadingAnimation } from "@/modules/loaders/components/AILoadingAnimation";
import { getReportProvider } from "../providers/registry";
import type { ReportProviderHostProps, ReportProviderId } from "../providers/types";

const loading = () => <AILoadingAnimation stage="fetching-token" />;

// Each host is its own chunk, so a provider's SDK (e.g. MSAL for Rayfin) never loads for the others.
const HOSTS: Record<ReportProviderId, ComponentType<ReportProviderHostProps>> = {
  "power-bi": dynamic(() => import("../providers/power-bi/PowerBiHost").then((m) => m.PowerBiHost), { ssr: false, loading }),
  "fabric-rayfin": dynamic(() => import("../providers/fabric-rayfin/RayfinHost").then((m) => m.RayfinHost), {
    ssr: false,
    loading,
  }),
  "azure-web-apps": dynamic(() => import("./ProviderPlaceholder").then((m) => m.ProviderPlaceholder), { ssr: false, loading }),
  "databricks-apps": dynamic(() => import("./ProviderPlaceholder").then((m) => m.ProviderPlaceholder), { ssr: false, loading }),
  "other-web-apps": dynamic(() => import("./ProviderPlaceholder").then((m) => m.ProviderPlaceholder), { ssr: false, loading }),
};

interface ReportHostProps {
  providerId: ReportProviderId;
  reportId?: string;
}

export function ReportHost({ providerId, reportId }: ReportHostProps) {
  const definition = getReportProvider(providerId);
  if (!definition) {
    return <div className="flex h-full items-center justify-center text-slate-500">Unknown report provider.</div>;
  }
  const Host = HOSTS[definition.id];
  // Keyed by provider so switching always unmounts the previous host and runs its cleanup.
  return <Host key={definition.id} definition={definition} reportId={reportId} />;
}
