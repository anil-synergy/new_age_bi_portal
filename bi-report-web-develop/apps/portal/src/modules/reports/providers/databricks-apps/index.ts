import { AUTH_NOTES_FIELD, OPEN_MODE_FIELD, type ProviderConfigField } from "../config-schema";
import type { ReportProviderDefinition } from "../types";

export const databricksAppsProvider: ReportProviderDefinition = {
  id: "databricks-apps",
  label: "Databricks Apps",
  description: "Apps hosted on Databricks Apps. Authentication and embedding are not defined yet.",
  status: "placeholder",
};

export const databricksAppsConfigFields: readonly ProviderConfigField[] = [
  { key: "workspaceUrl", label: "Databricks workspace URL", kind: "url", required: true, placeholder: "https://adb-<id>.azuredatabricks.net/" },
  { key: "appUrl", label: "App URL", kind: "url", required: true, placeholder: "https://<app>.databricksapps.com/" },
  { key: "appName", label: "App name", kind: "text" },
  OPEN_MODE_FIELD,
  AUTH_NOTES_FIELD,
];
