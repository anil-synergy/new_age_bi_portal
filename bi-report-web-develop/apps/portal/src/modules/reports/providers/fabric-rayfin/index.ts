import type { ProviderConfigField } from "../config-schema";
import type { ReportProviderDefinition } from "../types";

export const fabricRayfinProvider: ReportProviderDefinition = {
  id: "fabric-rayfin",
  label: "Fabric Rayfin",
  description: "A Fabric Rayfin app embedded with delegated Microsoft Entra sign-in.",
  status: "available",
};

/** Per-app values from the reference project. Tenant, client ID and scopes are per deployment (env). */
export const fabricRayfinConfigFields: readonly ProviderConfigField[] = [
  {
    key: "hostingUrl",
    label: "Hosting URL",
    kind: "url",
    required: true,
    placeholder: "https://<app>.webapp.fabricapps.net/",
    help: "Loaded in the iframe. Its origin is the only origin the embed host trusts.",
  },
  {
    key: "workspaceId",
    label: "Fabric workspace ID",
    kind: "guid",
    placeholder: "00000000-0000-0000-0000-000000000000",
    help: "Informational.",
  },
  {
    key: "appId",
    label: "Rayfin item ID",
    kind: "guid",
    placeholder: "00000000-0000-0000-0000-000000000000",
    help: "Informational.",
  },
];
