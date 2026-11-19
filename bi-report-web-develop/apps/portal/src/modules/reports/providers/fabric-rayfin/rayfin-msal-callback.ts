/** True when the URL looks like an MSAL auth-code redirect (or error) back to the SPA. */
export function hasRayfinMsalCallbackInUrl(search: string): boolean {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  if (params.has("error") || params.has("error_description")) return true;
  return params.has("code") && params.has("state");
}

export function hasRayfinMsalCallbackSearchParams(
  searchParams: Record<string, string | string[] | undefined> | undefined,
): boolean {
  if (!searchParams) return false;
  const pick = (key: string) => {
    const v = searchParams[key];
    return typeof v === "string" ? v : Array.isArray(v) ? v[0] : undefined;
  };
  if (pick("error") || pick("error_description")) return true;
  return Boolean(pick("code") && pick("state"));
}