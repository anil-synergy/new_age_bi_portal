const API_PREFIX = "bi-report-api/v1";

export const endpoints = {
  userInfo: `${API_PREFIX}/user/userInfo`,
  reports: `${API_PREFIX}/report/reports`,
  favoriteReport: `${API_PREFIX}/report/favoriteReport`,
  reportDownload: (id: string) => `${API_PREFIX}/report/token/report/${id}/download`,
  reportDetail: (id: string) => `${API_PREFIX}/admin/reports/${id}`,
  adminReports: `${API_PREFIX}/admin/reports`,
  allReports: `${API_PREFIX}/admin/getAllReports`,
  adminUser: `${API_PREFIX}/admin/user`,
  adminUsers: `${API_PREFIX}/admin/users`,
  bulkUsers: `${API_PREFIX}/admin/users/bulk`,
  adminGroups: `${API_PREFIX}/admin/user/group`,
  adminCategories: `${API_PREFIX}/admin/report/category`,
  allCategories: `${API_PREFIX}/admin/report/categories`,
  allRoles: `${API_PREFIX}/admin/role`,
  allEmails: `${API_PREFIX}/admin/users/email`,
  allUsers: `${API_PREFIX}/admin/allUsers`,
  displayReports: `${API_PREFIX}/admin/display-reports`,
  displayReport: (id: string) => `${API_PREFIX}/admin/display-reports/${id}`,
  reportPages: (id: string) => `${API_PREFIX}/admin/reports/${id}/pages`,
  semanticModel: (id: string) => `${API_PREFIX}/report/${id}/semantic-model`,
  permissionGroup: (reportId: string, groupId: string) =>
    `${API_PREFIX}/admin/reports/${reportId}/permission/group/${groupId}`,
  permissionUser: (reportId: string, userId: string) =>
    `${API_PREFIX}/admin/reports/${reportId}/permission/user/${userId}`,
};
