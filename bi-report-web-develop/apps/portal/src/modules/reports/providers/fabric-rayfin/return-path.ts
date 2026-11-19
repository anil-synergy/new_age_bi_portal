/** After MSAL redirect, restore the report route the user opened from the menu. */
export const RAYFIN_RETURN_PATH_KEY = "portal.rayfin.returnPath";

export function rayfinReturnPathForReport(reportId: string): string {
  return `/dashboard/${reportId}`;
}

/** Call before loginRedirect / acquireTokenRedirect when embedding a catalog app. */
export function storeRayfinReturnPath(reportId: string | undefined): void {
  if (typeof window === "undefined" || !reportId?.trim()) return;
  sessionStorage.setItem(RAYFIN_RETURN_PATH_KEY, rayfinReturnPathForReport(reportId.trim()));
}

export function peekRayfinReturnPath(): string | null {
  if (typeof window === "undefined") return null;
  return sessionStorage.getItem(RAYFIN_RETURN_PATH_KEY);
}

export function consumeRayfinReturnPath(): string | null {
  if (typeof window === "undefined") return null;
  const path = sessionStorage.getItem(RAYFIN_RETURN_PATH_KEY);
  if (path) sessionStorage.removeItem(RAYFIN_RETURN_PATH_KEY);
  return path;
}

/**
 * After handleRedirectPromise, navigate back to the menu report when Entra lands on the SPA redirect URI
 * (typically the bare origin, e.g. http://localhost:3000).
 * Returns true when a full-page navigation was started.
 */
export function restoreRayfinReturnPathAfterRedirect(): boolean {
  const target = consumeRayfinReturnPath();
  if (!target || typeof window === "undefined") return false;
  const pathname = window.location.pathname;
  const current = `${pathname}${window.location.search}`;
  if (current === target || pathname === target) return false;
  window.location.replace(target);
  return true;
}