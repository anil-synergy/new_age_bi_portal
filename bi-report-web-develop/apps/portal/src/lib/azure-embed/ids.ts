const EMPTY_GUID = "00000000-0000-0000-0000-000000000000";
const GUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** True when the value is a real Power BI / catalog GUID, not empty or missing. */
export function isRealGuid(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  return GUID_RE.test(trimmed) && trimmed !== EMPTY_GUID;
}

export function asGuid(value: unknown): string | undefined {
  if (typeof value === "string" && isRealGuid(value.trim())) return value.trim();
  return undefined;
}

/** First real GUID in the list. Empty GUID strings from .NET DTOs are skipped. */
export function firstGuid(...values: unknown[]): string | undefined {
  for (const value of values) {
    const guid = asGuid(value);
    if (guid) return guid;
  }
  return undefined;
}
