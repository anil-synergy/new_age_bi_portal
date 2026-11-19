export type ProviderFieldKind = "text" | "url" | "guid" | "textarea" | "select";

export interface ProviderConfigField {
  key: string;
  label: string;
  kind: ProviderFieldKind;
  required?: boolean;
  placeholder?: string;
  help?: string;
  options?: readonly { value: string; label: string }[];
  defaultValue?: string;
}

export type ProviderConfigValues = Record<string, string>;

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const OPEN_MODE_FIELD: ProviderConfigField = {
  key: "openMode",
  label: "Open mode",
  kind: "select",
  options: [
    { value: "embedded", label: "Embedded in the portal (iframe)" },
    { value: "new-tab", label: "Open in a new tab" },
  ],
  defaultValue: "embedded",
  help: "Embedding requires the app to allow framing by the portal origin.",
};

export const AUTH_NOTES_FIELD: ProviderConfigField = {
  key: "authNotes",
  label: "Authentication notes",
  kind: "textarea",
  placeholder: "How does this app sign users in? (informational; no auth flow is implemented yet)",
};

export function initialProviderValues(fields: readonly ProviderConfigField[]): ProviderConfigValues {
  return Object.fromEntries(fields.map((field) => [field.key, field.defaultValue ?? ""]));
}

function isHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || (url.protocol === "http:" && url.hostname === "localhost");
  } catch {
    return false;
  }
}

/** Returns one message per invalid field key. */
export function validateProviderConfig(
  fields: readonly ProviderConfigField[],
  values: ProviderConfigValues
): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const field of fields) {
    const value = (values[field.key] ?? "").trim();
    if (!value) {
      if (field.required) errors[field.key] = `${field.label} is required.`;
      continue;
    }
    if (field.kind === "url" && !isHttpsUrl(value)) errors[field.key] = `${field.label} must be an https:// URL.`;
    if (field.kind === "guid" && !GUID.test(value)) errors[field.key] = `${field.label} must be a valid GUID.`;
    if (field.kind === "select" && field.options && !field.options.some((option) => option.value === value)) {
      errors[field.key] = `Choose a valid ${field.label.toLowerCase()}.`;
    }
  }
  return errors;
}
