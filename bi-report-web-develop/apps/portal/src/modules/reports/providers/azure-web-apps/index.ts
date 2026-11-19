import { AUTH_NOTES_FIELD, OPEN_MODE_FIELD, type ProviderConfigField } from "../config-schema";
import type { ReportProviderDefinition } from "../types";

export const azureWebAppsProvider: ReportProviderDefinition = {
  id: "azure-web-apps",
  label: "Azure Web Apps",
  description: "Apps hosted on Azure App Service. Authentication and embedding are not defined yet.",
  status: "placeholder",
};

export const azureWebAppsConfigFields: readonly ProviderConfigField[] = [
  { key: "appUrl", label: "App URL", kind: "url", required: true, placeholder: "https://<app>.azurewebsites.net/" },
  { key: "appIdentifier", label: "App Service name or resource ID", kind: "text" },
  OPEN_MODE_FIELD,
  AUTH_NOTES_FIELD,
];
