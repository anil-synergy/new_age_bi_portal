import api from "@/lib/api/axios";
import { endpoints } from "@/lib/api/endpoints";
import type { BulkUserRow, DisplayReport, PageACL, PortalReport, UserInfo } from "@/types";

function catalogAuthHeaders(): HeadersInit | undefined {
  const token = typeof window !== "undefined" ? localStorage.getItem("access_token") : null;
  return token ? { Authorization: `Bearer ${token}` } : undefined;
}

async function catalogGet<T>(path: string): Promise<T> {
  const response = await fetch(path, { headers: catalogAuthHeaders() });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error((data as { message?: string })?.message ?? `Catalog request failed (${response.status})`);
    (error as { response?: { status: number; data: unknown } }).response = { status: response.status, data };
    throw error;
  }
  return data as T;
}

async function catalogPut<T>(path: string): Promise<T> {
  const response = await fetch(path, { method: "PUT", headers: catalogAuthHeaders() });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error((data as { message?: string })?.message ?? `Catalog request failed (${response.status})`);
    (error as { response?: { status: number; data: unknown } }).response = { status: response.status, data };
    throw error;
  }
  return data as T;
}

export type CatalogBundle = { userInfo: UserInfo; reports: PortalReport[] };

export const getCatalog = () => catalogGet<CatalogBundle>("/api/catalog");

export const getUserInfo = () => catalogGet<UserInfo>("/api/catalog/user-info");

export const getReports = () => catalogGet<PortalReport[]>("/api/catalog/reports");

export const getReportDetail = (id: string) =>
  api.get<PortalReport>(endpoints.reportDetail(id)).then((r) => r.data);

/** Entitled catalog row (Power BI or Fabric) from portal DB — not bi-report-api. */
export const getCatalogReportById = (id: string) => catalogGet<PortalReport>(`/api/catalog/reports/${encodeURIComponent(id)}`);

export const getAdminReport = (id: string) => api.get(endpoints.reportDetail(id)).then((r) => r.data);

const EMPTY_GUID = "00000000-0000-0000-0000-000000000000";

export const mapReportGroup = (reportId: string, groupId: string, roles: string[]) =>
  api.post(endpoints.permissionGroup(reportId, groupId), { rolesSelected: roles, bypassRLS: false }).then((r) => r.data);

export const mapReportUser = (reportId: string, userId: string, roles: string[]) =>
  api.post(endpoints.permissionUser(reportId, userId), { rolesSelected: roles, bypassRLS: false }).then((r) => r.data);

export const unmapReportGroup = (reportId: string, mappingGroupId: string) =>
  api.delete(`${endpoints.adminReports}/permission/group`, { data: { reportId, mappingGroupId, mappingUserId: EMPTY_GUID } }).then((r) => r.data);

export const unmapReportUser = (reportId: string, mappingUserId: string) =>
  api.delete(`${endpoints.adminReports}/permission/user`, { data: { reportId, mappingGroupId: EMPTY_GUID, mappingUserId } }).then((r) => r.data);

export const getAllAdminUsers = () => api.get(endpoints.allUsers).then((r) => r.data);

export const getAllReportsPaginated = (payload: object) =>
  api.post(endpoints.allReports, payload).then((r) => r.data);

export const addReport = (payload: object) => api.post(endpoints.adminReports, payload).then((r) => r.data);

export const editReport = (id: string, payload: object) =>
  api.put(`${endpoints.adminReports}/${id}`, payload).then((r) => r.data);

export const deleteReport = (id: string) => api.delete(`${endpoints.adminReports}/${id}`);

export const getUsers = (payload: object) => api.post(endpoints.adminUsers, payload).then((r) => r.data);

export const addUser = (payload: object) => api.post(endpoints.adminUser, payload).then((r) => r.data);

export const editUser = (id: string, payload: object) =>
  api.put(`${endpoints.adminUser}/${id}`, payload).then((r) => r.data);

export const deleteUser = (id: string) => api.delete(`${endpoints.adminUser}/${id}`);

export const bulkImportUsers = (users: BulkUserRow[]) =>
  api.post(endpoints.bulkUsers, { users }).then((r) => r.data);

export const getGroups = (payload?: { page?: number; pageSize?: number; search?: string; filterValue?: string }) =>
  api.get(endpoints.adminGroups, { params: payload }).then((r) => r.data);

export const addGroup = (payload: object) => api.post(endpoints.adminGroups, payload).then((r) => r.data);

export const editGroup = (id: string, payload: object) =>
  api.put(`${endpoints.adminGroups}/${id}`, payload).then((r) => r.data);

export const deleteGroup = (id: string) => api.delete(`${endpoints.adminGroups}/${id}`);

export const getCategories = () => api.get(endpoints.allCategories).then((r) => r.data);

export const getCategoriesPaged = (payload: { page: number; pageSize: number; search?: string }) =>
  api.get(endpoints.adminCategories, { params: payload }).then((r) => r.data);

export const addCategory = (payload: object) => api.post(endpoints.adminCategories, payload).then((r) => r.data);

export const editCategory = (id: string, payload: object) =>
  api.put(`${endpoints.adminCategories}/${id}`, payload).then((r) => r.data);

export const deleteCategory = (id: string) => api.delete(`${endpoints.adminCategories}/${id}`);

export const getRoles = () => api.get(endpoints.allRoles).then((r) => r.data);

export const getDisplayReports = () =>
  api.get<DisplayReport[]>(endpoints.displayReports).then((r) => r.data);

export const getDisplayReport = (id: string) =>
  api.get<DisplayReport>(endpoints.displayReport(id)).then((r) => r.data);

export const createDisplayReport = (payload: DisplayReport) =>
  api.post<DisplayReport>(endpoints.displayReports, payload).then((r) => r.data);

export const updateDisplayReport = (id: string, payload: DisplayReport) =>
  api.put<DisplayReport>(endpoints.displayReport(id), payload).then((r) => r.data);

export const deleteDisplayReport = (id: string) => api.delete(endpoints.displayReport(id));

export const getReportPageACL = (reportId: string) =>
  api.get<PageACL[]>(endpoints.reportPages(reportId)).then((r) => r.data);

export const updateReportPageACL = (reportId: string, pages: PageACL[]) =>
  api.put(endpoints.reportPages(reportId), { pages }).then((r) => r.data);

export const getSemanticModelCached = (reportId: string) =>
  api.get(endpoints.semanticModel(reportId)).then((r) => r.data);

export const toggleFavorite = (reportId: string) =>
  catalogPut<PortalReport[]>(`/api/catalog/favorites?reportId=${encodeURIComponent(reportId)}`);
