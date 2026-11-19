"use client";

import { createContext, useContext, useEffect, useMemo, useState, useCallback } from "react";
import type { PortalReport, SemanticModel, UserInfo } from "@/types";
import { getCatalog, getSemanticModelCached } from "@/services/biServices";
import { getStoredPortalUser } from "@/lib/auth/user-identity";
import { hasStoredAccessToken, isAuthEnabled } from "@/lib/config";

interface PortalContextValue {
  userInfo: UserInfo | null;
  reports: PortalReport[];
  isLoading: boolean;
  isSuperAdmin: boolean;
  isDepAdmin: boolean;
  semanticModel: SemanticModel | null;
  refreshUser: () => Promise<void>;
  updateReports: (reports: PortalReport[]) => void;
  loadSemanticModel: (reportId: string) => Promise<void>;
  userGroupIds: string[];
  userId: string;
  reportsError: string | null;
  userEmail: string;
}

const PortalContext = createContext<PortalContextValue | null>(null);

function mergeUserInfo(apiInfo: UserInfo | null, storedEmail?: string, storedName?: string): UserInfo | null {
  const stored = getStoredPortalUser();
  const email = apiInfo?.email ?? storedEmail ?? stored?.email ?? stored?.upn;
  if (!apiInfo && !email) return null;

  return {
    isSuperAdmin: apiInfo?.isSuperAdmin ?? false,
    isDepartmentAdmin: apiInfo?.isDepartmentAdmin ?? false,
    id: apiInfo?.id,
    email,
    name: apiInfo?.name ?? storedName ?? stored?.name,
    group: apiInfo?.group ?? [],
  };
}

export const CATALOG_CACHE_KEY = "portal_catalog_v1";
const CLIENT_CATALOG_TTL_MS = 30_000;

interface CatalogCache {
  email: string;
  userInfo: UserInfo | null;
  reports: PortalReport[];
  fetchedAt?: number;
}

function readCatalogCache(email: string): CatalogCache | null {
  if (!email) return null;
  try {
    const raw = localStorage.getItem(CATALOG_CACHE_KEY);
    const parsed = raw ? (JSON.parse(raw) as CatalogCache) : null;
    return parsed?.email === email && Array.isArray(parsed.reports) ? parsed : null;
  } catch {
    return null;
  }
}

function writeCatalogCache(email: string, userInfo: UserInfo | null, reports: PortalReport[]) {
  if (!email) return;
  try {
    localStorage.setItem(
      CATALOG_CACHE_KEY,
      JSON.stringify({ email, userInfo, reports, fetchedAt: Date.now() }),
    );
  } catch {
    // Quota exceeded: the catalog simply loads from the network next time.
  }
}

function isClientCatalogFresh(cache: CatalogCache): boolean {
  return Boolean(cache.fetchedAt && Date.now() - cache.fetchedAt < CLIENT_CATALOG_TTL_MS);
}

export function PortalProvider({ children }: { children: React.ReactNode }) {
  const [userInfo, setUserInfo] = useState<UserInfo | null>(null);
  const [reports, setReports] = useState<PortalReport[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [semanticModel, setSemanticModel] = useState<SemanticModel | null>(null);
  const [reportsError, setReportsError] = useState<string | null>(null);

  const updateReports = useCallback((menu: PortalReport[]) => {
    setReports(menu);
    const stored = getStoredPortalUser();
    const ownerEmail = (stored?.email ?? stored?.upn ?? "").toLowerCase();
    if (ownerEmail) {
      setUserInfo((prev) => {
        writeCatalogCache(ownerEmail, prev, menu);
        return prev;
      });
    }
  }, []);

  const refreshUser = useCallback(async (options?: { force?: boolean }) => {
    setReportsError(null);

    const hasToken = hasStoredAccessToken();
    if (!hasToken) {
      setUserInfo(null);
      setReports([]);
      setIsLoading(false);
      return;
    }

    const stored = getStoredPortalUser();
    const ownerEmail = (stored?.email ?? stored?.upn ?? "").toLowerCase();
    const cached = readCatalogCache(ownerEmail);
    const cacheFresh = Boolean(cached && isClientCatalogFresh(cached));
    if (cached) {
      setUserInfo(cached.userInfo);
      setReports(cached.reports);
      setIsLoading(false);
    } else {
      setIsLoading(true);
    }

    if (cacheFresh && !options?.force) {
      return;
    }

    try {
      const bundle = await getCatalog();
      const merged = mergeUserInfo(bundle.userInfo);
      setUserInfo(merged);
      setReports(bundle.reports);
      writeCatalogCache(ownerEmail, merged, bundle.reports);
    } catch (error) {
      if (cached) return;
      const stored = getStoredPortalUser();
      setUserInfo(mergeUserInfo(null, stored?.email, stored?.name));
      setReports([]);
      const err = error as {
        message?: string;
        response?: {
          status?: number;
          data?: { message?: string; detail?: string; database?: string };
        };
      };
      const status = err.response?.status;
      const api = err.response?.data;
      if (status === 401) {
        setReportsError("Sign in with Microsoft to load your report catalog.");
      } else if (status === 500) {
        const base = api?.message ?? err.message ?? "Could not load reports from the database.";
        const detail = api?.detail ? ` ${api.detail}` : "";
        const db = api?.database ? ` (database: ${api.database})` : "";
        setReportsError(`${base}${detail}${db}`);
      } else {
        setReportsError(err.message ?? "Could not load reports. Sign in or check database access.");
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  const loadSemanticModel = useCallback(
    async (reportId: string) => {
      if (!hasStoredAccessToken() && !isAuthEnabled()) return;

      try {
        const model = await getSemanticModelCached(reportId);
        setSemanticModel(model);
      } catch {
        setSemanticModel(null);
      }
    },
    []
  );

  useEffect(() => {
    refreshUser();
  }, [refreshUser]);

  useEffect(() => {
    const onTokenReady = () => refreshUser({ force: true });
    const onAdminChanged = () => refreshUser({ force: true });
    window.addEventListener("portal:token-ready", onTokenReady);
    window.addEventListener("portal:admin-changed", onAdminChanged);
    return () => {
      window.removeEventListener("portal:token-ready", onTokenReady);
      window.removeEventListener("portal:admin-changed", onAdminChanged);
    };
  }, [refreshUser]);

  const value = useMemo<PortalContextValue>(() => {
    const stored = typeof window !== "undefined" ? getStoredPortalUser() : null;
    return {
      userInfo,
      reports,
      isLoading,
      isSuperAdmin: userInfo?.isSuperAdmin ?? false,
      isDepAdmin: userInfo?.isDepartmentAdmin ?? false,
      semanticModel,
      refreshUser,
      updateReports,
      loadSemanticModel,
      userGroupIds: userInfo?.group?.map((g) => g.id) ?? [],
      userId: userInfo?.id ?? (typeof window !== "undefined" ? localStorage.getItem("userId") ?? "" : ""),
      reportsError,
      userEmail: userInfo?.email ?? stored?.email ?? stored?.upn ?? "",
    };
  }, [userInfo, reports, isLoading, semanticModel, refreshUser, updateReports, loadSemanticModel, reportsError]);

  return <PortalContext.Provider value={value}>{children}</PortalContext.Provider>;
}

export function usePortal() {
  const ctx = useContext(PortalContext);
  if (!ctx) throw new Error("usePortal must be used within PortalProvider");
  return ctx;
}
