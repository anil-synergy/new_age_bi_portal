import { powerBiProvider } from "./power-bi";
import { fabricRayfinProvider, fabricRayfinConfigFields } from "./fabric-rayfin";
import { azureWebAppsProvider, azureWebAppsConfigFields } from "./azure-web-apps";
import { databricksAppsProvider, databricksAppsConfigFields } from "./databricks-apps";
import { otherWebAppsProvider, otherWebAppsConfigFields } from "./other-web-apps";
import type { ProviderConfigField } from "./config-schema";
import type { ReportProviderDefinition, ReportProviderId } from "./types";

export const DEFAULT_REPORT_PROVIDER = "power-bi" satisfies ReportProviderId;

export const REPORT_PROVIDERS: readonly ReportProviderDefinition[] = [
  powerBiProvider,
  fabricRayfinProvider,
  azureWebAppsProvider,
  databricksAppsProvider,
  otherWebAppsProvider,
];

/** Provider-specific admin form fields. Power BI keeps its existing form in the admin Reports page. */
export const PROVIDER_CONFIG_FIELDS: Record<Exclude<ReportProviderId, "power-bi">, readonly ProviderConfigField[]> = {
  "fabric-rayfin": fabricRayfinConfigFields,
  "azure-web-apps": azureWebAppsConfigFields,
  "databricks-apps": databricksAppsConfigFields,
  "other-web-apps": otherWebAppsConfigFields,
};

export function getReportProvider(id: string | null | undefined): ReportProviderDefinition | null {
  return REPORT_PROVIDERS.find((provider) => provider.id === id) ?? null;
}
