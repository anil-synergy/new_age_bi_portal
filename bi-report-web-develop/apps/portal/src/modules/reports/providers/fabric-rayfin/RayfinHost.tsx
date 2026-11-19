"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { InteractionRequiredAuthError, type PublicClientApplication } from "@azure/msal-browser";
import { REPORT_REFRESH_DONE_EVENT, REPORT_REFRESH_EVENT } from "@/lib/report-events";
import { AILoadingAnimation } from "@/modules/loaders/components/AILoadingAnimation";
import { Button } from "@/modules/shared/components/ui/button";
import type { ReportProviderHostProps } from "../types";
import {
  getRayfinConfigForApp,
  isEntraRedirectMismatchError,
  missingRayfinConfig,
  type RayfinConfig,
} from "./config";
import { getRayfinMsal, portalLoginHint, resolvePortalAccount, tryRayfinSsoSilent } from "./msal";
import { RayfinEmbed } from "./RayfinEmbed";
import { usePortal } from "@/context/PortalContext";
import { storeRayfinReturnPath } from "./return-path";

type Phase =
  | { kind: "initializing" }
  | { kind: "signed-out" }
  | { kind: "checking" }
  | { kind: "needs-consent" }
  | { kind: "embedding" }
  | { kind: "error"; message: string };

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function RayfinHost({ reportId }: ReportProviderHostProps) {
  const { reports, isLoading: catalogLoading } = usePortal();
  const catalogReport = useMemo(
    () => (reportId ? reports.find((r) => r.id === reportId) : undefined),
    [reportId, reports],
  );
  const fromCatalog = Boolean(reportId);
  const config = useMemo<RayfinConfig>(
    () =>
      getRayfinConfigForApp(
        {
          appUrl: catalogReport?.hostingUrl,
          workspaceId: catalogReport?.workspaceId ?? catalogReport?.powerWorkSpaceId,
          appId: catalogReport?.fabricAppId ?? catalogReport?.powerBiReportId,
        },
        { fromCatalogOnly: fromCatalog },
      ),
    [catalogReport, fromCatalog],
  );
  const missing = useMemo(
    () => missingRayfinConfig(config, { requireCatalogAppUrl: fromCatalog }),
    [config, fromCatalog],
  );

  const [phase, setPhase] = useState<Phase>({ kind: "initializing" });
  const [embedKey, setEmbedKey] = useState(0);
  const [redirecting, setRedirecting] = useState(false);
  const msalRef = useRef<PublicClientApplication | null>(null);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  // Called by the embed host for each handoff. It runs from a postMessage handler,
  // so it must stay silent: a popup would be blocked and a redirect would tear down the embed.
  const getAccessToken = useCallback(async () => {
    const instance = msalRef.current;
    const account = instance?.getActiveAccount();
    if (!instance || !account) throw new Error("No signed-in account.");
    const result = await instance.acquireTokenSilent({ account, scopes: config.scopes });
    return result.accessToken;
  }, [config.scopes]);

  // Acquire the delegated token before mounting the iframe, so consent or MFA
  // is handled here instead of mid-handshake.
  const preflight = useCallback(async (isActive: () => boolean) => {
    setPhase({ kind: "checking" });
    try {
      await getAccessToken();
      if (!isActive()) return;
      setEmbedKey((k) => k + 1);
      setPhase({ kind: "embedding" });
    } catch (error) {
      if (!isActive()) return;
      setPhase(
        error instanceof InteractionRequiredAuthError
          ? { kind: "needs-consent" }
          : { kind: "error", message: `Token acquisition failed: ${errorMessage(error)}` }
      );
    }
  }, [getAccessToken]);

  useEffect(() => {
    if (fromCatalog && catalogLoading) return;
    if (fromCatalog && !catalogLoading && !catalogReport) {
      setPhase({ kind: "error", message: "This Fabric app is not in your catalog or access was denied." });
      return;
    }
    if (missing.length > 0) return;
    let active = true;
    const isActive = () => active;
    (async () => {
      try {
        const instance = await getRayfinMsal(config);
        if (!active) return;
        msalRef.current = instance;
        let account = await resolvePortalAccount(instance);
        if (!active) return;
        if (!account) {
          await tryRayfinSsoSilent(instance, config);
          if (!active) return;
          account = instance.getActiveAccount();
        }
        if (!account) {
          setPhase({ kind: "signed-out" });
          return;
        }
        await preflight(isActive);
      } catch (error) {
        if (active) setPhase({ kind: "error", message: `Microsoft sign-in could not start: ${errorMessage(error)}` });
      }
    })();
    return () => {
      active = false;
      msalRef.current = null;
    };
  }, [catalogLoading, catalogReport, config, fromCatalog, missing.length, preflight]);

  useEffect(() => {
    const onRefresh = () => {
      if (phaseRef.current.kind === "embedding") setEmbedKey((k) => k + 1);
      window.dispatchEvent(new Event(REPORT_REFRESH_DONE_EVENT));
    };
    window.addEventListener(REPORT_REFRESH_EVENT, onRefresh);
    return () => window.removeEventListener(REPORT_REFRESH_EVENT, onRefresh);
  }, []);

  const signIn = async () => {
    const instance = msalRef.current;
    if (!instance) return;
    setRedirecting(true);
    try {
      storeRayfinReturnPath(reportId);
      await instance.loginRedirect({ scopes: config.scopes, loginHint: portalLoginHint() });
    } catch (error) {
      setRedirecting(false);
      setPhase({ kind: "error", message: `Sign-in failed: ${errorMessage(error)}` });
    }
  };

  const grantConsent = async () => {
    const instance = msalRef.current;
    const account = instance?.getActiveAccount();
    if (!instance || !account) return;
    setRedirecting(true);
    try {
      storeRayfinReturnPath(reportId);
      await instance.acquireTokenRedirect({ account, scopes: config.scopes });
    } catch (error) {
      setRedirecting(false);
      setPhase({ kind: "error", message: `Consent failed: ${errorMessage(error)}` });
    }
  };

  if (fromCatalog && catalogLoading) {
    return <AILoadingAnimation stage="fetching-token" message="Loading Fabric app from catalog…" />;
  }

  if (missing.length > 0) {
    return (
      <StatusCard title="Fabric Rayfin is not configured">
        <p>
          Missing configuration: <strong>{missing.join(", ")}</strong>
        </p>
        <p className="mt-2">
          {fromCatalog
            ? "Set hosting URL on this app in Administration → Reports, and Rayfin Entra settings in apps/portal/.env.local."
            : "Set these in apps/portal/.env.local (see .env.example) and restart the dev server."}
        </p>
      </StatusCard>
    );
  }

  if (phase.kind === "initializing" || phase.kind === "checking") {
    return (
      <AILoadingAnimation
        stage="fetching-token"
        message={phase.kind === "initializing" ? "Connecting to Microsoft Entra…" : "Acquiring Fabric access…"}
      />
    );
  }

  if (phase.kind === "embedding") {
    return (
      <RayfinEmbed
        key={embedKey}
        appUrl={config.appUrl}
        appOrigin={config.appOrigin}
        getAccessToken={getAccessToken}
        onReload={() => setEmbedKey((k) => k + 1)}
      />
    );
  }

  return (
    <StatusCard title="Fabric Rayfin" details={<ConnectionDetails config={config} />}>
      {phase.kind === "signed-out" && (
        <>
          <p>
            Fabric Rayfin needs a <strong>delegated</strong> Entra token ({config.scopes.join(" ")}) for the iframe
            handshake. Portal SSO and <strong>BI_Portal_Auth</strong> (service-principal embed tokens) are separate and
            cannot replace this step.
          </p>
          <p className="mt-2 text-slate-500">
            After Entra is configured, you may only need to confirm consent once; your portal session does not share
            tokens with this Rayfin SPA client ({config.clientId}).
          </p>
          <Button className="mt-3" onClick={signIn} disabled={redirecting}>
            {redirecting ? "Signing in…" : "Sign in with Microsoft"}
          </Button>
        </>
      )}
      {phase.kind === "needs-consent" && (
        <>
          <p>Microsoft needs you to confirm access to Fabric before the app can open.</p>
          <Button className="mt-3" onClick={grantConsent} disabled={redirecting}>
            {redirecting ? "Redirecting…" : "Continue with Microsoft"}
          </Button>
        </>
      )}
      {phase.kind === "error" && (
        <>
          <p className="text-red-600">{phase.message}</p>
          {isEntraRedirectMismatchError(phase.message) && (
            <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-950">
              <p className="font-medium">Fix AADSTS50011 (redirect URI)</p>
              <ol className="mt-1 list-decimal pl-4 space-y-1">
                <li>
                  In Entra → App registrations → client <code className="break-all">{config.clientId}</code> →{" "}
                  <strong>Authentication</strong>.
                </li>
                <li>
                  Under <strong>Single-page application</strong>, add this exact redirect URI (not &quot;Web&quot;):{" "}
                  <code className="break-all">{config.redirectUri}</code>
                </li>
                <li>
                  Use a <strong>public SPA</strong> app registration — not the BI_Portal_Auth confidential / service
                  principal client ID.
                </li>
                <li>Save, wait ~1 minute, restart <code>npm run dev</code> if you changed <code>.env.local</code>.</li>
              </ol>
            </div>
          )}
          <Button
            className="mt-3"
            variant="outline"
            onClick={() => {
              if (msalRef.current?.getActiveAccount()) void preflight(() => true);
              else setPhase({ kind: "signed-out" });
            }}
          >
            Try again
          </Button>
        </>
      )}
    </StatusCard>
  );
}

function StatusCard({ title, children, details }: { title: string; children: React.ReactNode; details?: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-600 shadow-sm">
        <h2 className="mb-2 text-base font-semibold text-[#0b2540]">{title}</h2>
        {children}
        {details}
      </div>
    </div>
  );
}

function ConnectionDetails({ config }: { config: RayfinConfig }) {
  const rows: [string, string][] = [
    ["Tenant", config.tenantId],
    ["Client ID", config.clientId],
    ["Redirect URI", config.redirectUri],
    ["Scopes", config.scopes.join(" ")],
    ["Workspace", config.workspaceId || "-"],
    ["Rayfin item", config.appId || "-"],
    ["Rayfin URL", config.appUrl],
  ];
  return (
    <details className="mt-4 text-xs">
      <summary className="cursor-pointer text-slate-500">Connection details</summary>
      <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="font-medium text-slate-500">{label}</dt>
            <dd className="break-all text-slate-700">{value}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
