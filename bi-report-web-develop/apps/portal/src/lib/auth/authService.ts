import { jwtDecode } from "jwt-decode";
import { buildMicrosoftAuthorizeUrl, microsoftAuthConfig } from "./microsoft-config";
import { storePortalUser, type StoredPortalUser } from "./user-identity";

const SILENT_TRIED_KEY = "portal_sso_silent_tried";
const SKIP_SILENT_KEY = "portal_sso_skip_silent";
const LAST_UPN_KEY = "portal_last_upn";
const RETURN_TO_KEY = "redirectUri";

export function clearAuthStorage() {
  if (typeof window === "undefined") return;
  const keysToRemove: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (
      key &&
      (key === "access_token" ||
        key === "id_token" ||
        key === "userId" ||
        key === "portal_user" ||
        key === "portal_catalog_v1" ||
        key === RETURN_TO_KEY)
    ) {
      keysToRemove.push(key);
    }
  }
  keysToRemove.forEach((k) => localStorage.removeItem(k));

  const sessionKeys: string[] = [];
  for (let i = 0; i < sessionStorage.length; i++) {
    const key = sessionStorage.key(i);
    if (key?.startsWith("portal_ms_auth_")) sessionKeys.push(key);
  }
  sessionKeys.forEach((k) => sessionStorage.removeItem(k));
}

function isTokenExpired(token: string): boolean {
  try {
    const decoded = jwtDecode<{ exp: number }>(token);
    return decoded.exp * 1000 < Date.now() + 5000;
  } catch {
    return true;
  }
}

function safeReturnPath(path: string | null | undefined): string {
  if (!path || !path.startsWith("/") || path.startsWith("//")) return "/dashboard";
  if (/^\/(login|auth|authentication|logout|redirecting)(\/|$)/.test(path)) return "/dashboard";
  return path;
}

export default class AuthService {
  /**
   * Starts the Entra code flow. `silent` uses prompt=none so an existing Microsoft
   * session signs the user in with no UI; Entra returns login_required otherwise.
   */
  signinRedirect = (options: { silent?: boolean; returnTo?: string } = {}) => {
    const returnTo = safeReturnPath(options.returnTo ?? localStorage.getItem(RETURN_TO_KEY));
    clearAuthStorage();
    localStorage.setItem(RETURN_TO_KEY, returnTo);
    sessionStorage.removeItem(SKIP_SILENT_KEY);
    if (options.silent) sessionStorage.setItem(SILENT_TRIED_KEY, "1");
    window.location.href = buildMicrosoftAuthorizeUrl({
      silent: options.silent,
      loginHint: localStorage.getItem(LAST_UPN_KEY) ?? undefined,
    });
  };

  /** Silent SSO is attempted once per tab, and never right after an explicit logout. */
  canTrySilentSignin = () => {
    if (typeof window === "undefined") return false;
    return !sessionStorage.getItem(SILENT_TRIED_KEY) && !sessionStorage.getItem(SKIP_SILENT_KEY);
  };

  consumeReturnPath = () => {
    const path = safeReturnPath(localStorage.getItem(RETURN_TO_KEY));
    localStorage.removeItem(RETURN_TO_KEY);
    return path;
  };

  isAuthenticated = () => {
    if (typeof window === "undefined") return false;
    const token = localStorage.getItem("access_token");
    return Boolean(token && !isTokenExpired(token));
  };

  logout = () => {
    clearAuthStorage();
    sessionStorage.setItem(SKIP_SILENT_KEY, "1");
    const tenantId = microsoftAuthConfig.tenantId;
    const postLogout = encodeURIComponent(window.location.origin + "/login");
    window.location.href = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/logout?post_logout_redirect_uri=${postLogout}`;
  };

  persistSession(
    accessToken: string,
    user: StoredPortalUser & { userId?: string }
  ) {
    localStorage.setItem("access_token", accessToken);
    localStorage.setItem("userId", user.userId ?? user.email);
    localStorage.setItem(LAST_UPN_KEY, user.upn || user.email);
    sessionStorage.removeItem(SILENT_TRIED_KEY);
    storePortalUser({
      email: user.email,
      upn: user.upn,
      name: user.name,
      loginType: "SSO",
    });
    window.dispatchEvent(new Event("portal:token-ready"));
  }
}
