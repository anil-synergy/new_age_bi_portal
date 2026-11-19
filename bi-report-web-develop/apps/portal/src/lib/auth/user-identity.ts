export interface MicrosoftIdClaims {
  sub?: string;
  preferred_username?: string;
  upn?: string;
  email?: string;
  name?: string;
}

/** Resolve UPN/email from Microsoft id_token claims (preferred_username is typically the UPN). */
export function upnToEmail(claims: MicrosoftIdClaims): string | null {
  const raw =
    claims.preferred_username?.trim() ||
    claims.upn?.trim() ||
    claims.email?.trim() ||
    null;
  if (!raw) return null;
  return raw.toLowerCase();
}

export interface StoredPortalUser {
  email: string;
  upn: string;
  name?: string;
  loginType: "SSO";
}

export const PORTAL_USER_STORAGE_KEY = "portal_user";

export function getStoredPortalUser(): StoredPortalUser | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(PORTAL_USER_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as StoredPortalUser) : null;
  } catch {
    return null;
  }
}

export function storePortalUser(user: StoredPortalUser) {
  if (typeof window === "undefined") return;
  localStorage.setItem(PORTAL_USER_STORAGE_KEY, JSON.stringify(user));
}

export function getUserEmailForRls(userInfoEmail?: string | null): string | undefined {
  const stored = getStoredPortalUser();
  return userInfoEmail?.trim() || stored?.email || stored?.upn || undefined;
}
