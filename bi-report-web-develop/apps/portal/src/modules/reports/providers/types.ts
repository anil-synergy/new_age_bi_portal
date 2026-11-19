export type ReportProviderId =
  | "power-bi"
  | "fabric-rayfin"
  | "azure-web-apps"
  | "databricks-apps"
  | "other-web-apps";

export type ReportProviderStatus = "available" | "placeholder";

/** Metadata every provider module exports from its `index.ts`. */
export interface ReportProviderDefinition {
  id: ReportProviderId;
  label: string;
  description: string;
  status: ReportProviderStatus;
}

/**
 * Props `ReportHost` passes to a provider host. A host owns its whole lifecycle:
 * everything it creates (SDK instances, listeners, iframes, timers) must be torn
 * down in its unmount cleanup, because switching providers unmounts it.
 */
export interface ReportProviderHostProps {
  definition: ReportProviderDefinition;
  /** Catalog report id (`bi_report` or `bi_fabric_apps`); Power BI and Fabric Rayfin use it. */
  reportId?: string;
}
