import { loadCatalogForEmail } from "./reports-catalog";
import type { PortalReport, UserInfo } from "@/types";

export async function loadReportsForUser(
  _authorization: string,
  email: string
): Promise<{ reports: PortalReport[]; userInfo: UserInfo; source: "database" }> {
  const catalog = await loadCatalogForEmail(email);
  return {
    reports: catalog.reports,
    userInfo: catalog.userInfo,
    source: "database",
  };
}

export async function loadUserInfoForUser(_authorization: string, email: string): Promise<UserInfo> {
  const catalog = await loadCatalogForEmail(email);
  return catalog.userInfo;
}
