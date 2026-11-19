import { LogLevel, PublicClientApplication, type AccountInfo } from "@azure/msal-browser";
import { getStoredPortalUser } from "@/lib/auth/user-identity";
import type { RayfinConfig } from "./config";
import { restoreRayfinReturnPathAfterRedirect } from "./return-path";

let instancePromise: Promise<PublicClientApplication> | null = null;

/**
 * One MSAL client per page load. It is separate from the portal's own sign-in
 * (which issues an app JWT, not a Fabric-scoped Entra token) and keeps its cache
 * in sessionStorage, so it ends with the browser tab.
 */
export function getRayfinMsal(config: RayfinConfig): Promise<PublicClientApplication> {
  if (!instancePromise) {
    instancePromise = (async () => {
      const instance = new PublicClientApplication({
        auth: {
          clientId: config.clientId,
          authority: `https://login.microsoftonline.com/${config.tenantId}`,
          redirectUri: config.redirectUri,
          postLogoutRedirectUri: config.redirectUri,
        },
        cache: { cacheLocation: "sessionStorage" },
        system: {
          loggerOptions: {
            logLevel: LogLevel.Warning,
            piiLoggingEnabled: false,
            loggerCallback: (level, message, containsPii) => {
              if (containsPii) return;
              if (level === LogLevel.Error) console.error(message);
              else if (level === LogLevel.Warning) console.warn(message);
            },
          },
        },
      });
      await instance.initialize();
      // Completes a pending loginRedirect/acquireTokenRedirect that returned to this page.
      const redirectResult = await instance.handleRedirectPromise();
      if (redirectResult?.account) instance.setActiveAccount(redirectResult.account);
      if (restoreRayfinReturnPathAfterRedirect()) {
        return await new Promise<PublicClientApplication>(() => {
          // Full-page navigation back to /dashboard/{reportId}; this tab is leaving.
        });
      }
      return instance;
    })();
    instancePromise.catch(() => {
      instancePromise = null;
    });
  }
  return instancePromise;
}

function portalIdentities(): string[] {
  const user = getStoredPortalUser();
  return [user?.upn, user?.email].filter((v): v is string => Boolean(v?.trim())).map((v) => v.trim().toLowerCase());
}

/**
 * Picks the cached Entra account that belongs to the signed-in portal user. A cache
 * left behind by a different user is cleared so their tokens are never reused.
 */
export async function resolvePortalAccount(instance: PublicClientApplication): Promise<AccountInfo | null> {
  const accounts = instance.getAllAccounts();
  const identities = portalIdentities();
  if (identities.length === 0) {
    const account = instance.getActiveAccount() ?? accounts[0] ?? null;
    if (account) instance.setActiveAccount(account);
    return account;
  }
  const match = accounts.find((a) => identities.includes(a.username.toLowerCase())) ?? null;
  if (match) {
    instance.setActiveAccount(match);
    return match;
  }
  if (accounts.length > 0) {
    instance.setActiveAccount(null);
    await instance.clearCache();
  }
  return null;
}

export function portalLoginHint(): string | undefined {
  return portalIdentities()[0];
}

/** Try Entra session cookie SSO before interactive login (same SPA + registered redirect URI required). */
export async function tryRayfinSsoSilent(
  instance: PublicClientApplication,
  config: RayfinConfig,
): Promise<import("@azure/msal-browser").AuthenticationResult | null> {
  const hint = portalLoginHint();
  if (!hint) return null;
  try {
    const result = await instance.ssoSilent({
      scopes: config.scopes,
      loginHint: hint,
      redirectUri: config.redirectUri,
    });
    if (result.account) instance.setActiveAccount(result.account);
    return result;
  } catch {
    return null;
  }
}
