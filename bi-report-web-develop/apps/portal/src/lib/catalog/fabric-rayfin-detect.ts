import type { PortalReport } from "@/types";

/** True when the catalog row should use Rayfin MSAL embed (not Power BI BI_Portal_Auth). */
export function isFabricRayfinCatalogReport(
  report: Pick<PortalReport, "applicationType" | "hostingUrl"> | null | undefined,
): boolean {
  if (!report) return false;
  if (report.applicationType === "fabric-rayfin") return true;
  const url = report.hostingUrl?.trim();
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}