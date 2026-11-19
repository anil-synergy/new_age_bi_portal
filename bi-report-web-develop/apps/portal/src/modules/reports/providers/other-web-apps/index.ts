import { AUTH_NOTES_FIELD, OPEN_MODE_FIELD, type ProviderConfigField } from "../config-schema";
import type { ReportProviderDefinition } from "../types";

export const otherWebAppsProvider: ReportProviderDefinition = {
  id: "other-web-apps",
  label: "Other Web Apps",
  description: "Any other embeddable web app. Authentication and embedding are not defined yet.",
  status: "placeholder",
};

export const otherWebAppsConfigFields: readonly ProviderConfigField[] = [
  { key: "appUrl", label: "App URL", kind: "url", required: true, placeholder: "https://" },
  OPEN_MODE_FIELD,
  AUTH_NOTES_FIELD,
];
