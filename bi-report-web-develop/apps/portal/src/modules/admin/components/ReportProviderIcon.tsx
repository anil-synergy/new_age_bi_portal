import type { ReportProviderId } from "@/modules/reports/providers/types";
import { Box, Cloud, Database, LayoutGrid } from "lucide-react";

/** Small provider glyphs for admin report form (existing portal palette, not vendor brand colors). */
export function ReportProviderIcon({ id, className = "h-5 w-5" }: { id: ReportProviderId; className?: string }) {
  switch (id) {
    case "power-bi":
      return (
        <svg className={className} viewBox="0 0 24 24" aria-hidden>
          <rect x="3" y="14" width="4" height="7" rx="0.5" fill="#0d9488" />
          <rect x="9" y="10" width="4" height="11" rx="0.5" fill="#14b8a6" />
          <rect x="15" y="5" width="4" height="16" rx="0.5" fill="#1d4e89" />
        </svg>
      );
    case "fabric-rayfin":
      return <Database className={className} strokeWidth={1.75} />;
    case "azure-web-apps":
      return <Cloud className={className} strokeWidth={1.75} />;
    case "databricks-apps":
      return <LayoutGrid className={className} strokeWidth={1.75} />;
    default:
      return <Box className={className} strokeWidth={1.75} />;
  }
}