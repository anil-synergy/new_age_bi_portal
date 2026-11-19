"use client";

import { useEffect, useState } from "react";
import { ReportPagePermissions } from "@/modules/admin/components/ReportPagePermissions";
import { AdminPager, AdminScreen, AdminToolbar, Flag, RowMenu, apiError, notifyAdminChanged, readPage, type TagOption } from "@/modules/admin/components/AdminChrome";
import { addReport, deleteReport, editReport, getAdminReport, getAllAdminUsers, getAllReportsPaginated, getCategories, getRoles, mapReportGroup, mapReportUser, unmapReportGroup, unmapReportUser } from "@/services/biServices";
import { AdminReportForm } from "@/modules/admin/components/AdminReportForm";
import { DEFAULT_REPORT_PROVIDER, PROVIDER_CONFIG_FIELDS, getReportProvider } from "@/modules/reports/providers/registry";
import { initialProviderValues, validateProviderConfig, type ProviderConfigValues } from "@/modules/reports/providers/config-schema";
import type { ReportProviderId } from "@/modules/reports/providers/types";
import { toTreeTagOptions, type FlatCategory } from "@/modules/admin/utils/category-tree";

const EMPTY = "00000000-0000-0000-0000-000000000000";

type Category = FlatCategory;
type RlsRole = { id?: string; rlsRole: string };
type ReportRow = {
  id: string;
  title?: string;
  name?: string;
  description?: string;
  categoryId?: string;
  categoryName?: string;
  rlsEnabled?: boolean;
  enablePagination?: boolean;
  powerBiReportId?: string;
  semanticModelId?: string;
  workspaceId?: string;
  powerWorkSpaceId?: string;
  powerBiRlsRole?: RlsRole[] | null;
};

const blank = {
  id: "",
  name: "",
  description: "",
  reportCategory: "",
  powerBiReportId: "",
  semanticModelId: "",
  powerWorkSpaceId: "",
  rlsEnabled: false,
  enablePagination: true,
  roles: [] as RlsRole[],
};

export default function AdminReportsPage() {
  const [rows, setRows] = useState<ReportRow[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [groupOptions, setGroupOptions] = useState<TagOption[]>([]);
  const [userOptions, setUserOptions] = useState<TagOption[]>([]);
  const [categoryTag, setCategoryTag] = useState<TagOption[]>([]);
  const [groupTags, setGroupTags] = useState<TagOption[]>([]);
  const [userTags, setUserTags] = useState<TagOption[]>([]);
  const [savedGroups, setSavedGroups] = useState<TagOption[]>([]);
  const [savedUsers, setSavedUsers] = useState<TagOption[]>([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [totalPages, setTotalPages] = useState(1);
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [category, setCategory] = useState("");
  const [appliedCategory, setAppliedCategory] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState(blank);
  const [editing, setEditing] = useState(false);
  const [roleName, setRoleName] = useState("");
  const [saving, setSaving] = useState(false);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [acl, setAcl] = useState<ReportRow | null>(null);
  const [provider, setProvider] = useState<ReportProviderId>(DEFAULT_REPORT_PROVIDER);
  const [providerValues, setProviderValues] = useState<ProviderConfigValues>({});
  const [providerErrors, setProviderErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);

  const chooseProvider = (next: ReportProviderId) => {
    setProvider(next);
    setProviderValues(next === DEFAULT_REPORT_PROVIDER ? {} : initialProviderValues(PROVIDER_CONFIG_FIELDS[next]));
    setProviderErrors({});
    setNotice(null);
  };

  const load = (nextPage = page, nextSize = pageSize, nextSearch = appliedSearch, nextCategory = appliedCategory) => {
    setError(null);
    getAllReportsPaginated({
      page: nextPage,
      pageSize: nextSize,
      search: nextSearch,
      filterValue: nextCategory || null,
    })
      .then((data) => {
        const result = readPage<ReportRow>(data);
        setRows(result.items);
        setPage(result.page);
        setTotalPages(result.totalPages);
      })
      .catch((reason) => setError(apiError(reason, "Reports could not be loaded.")));
  };

  useEffect(() => {
    load(1, 20, "", "");
    const loadCategories = () => {
      getCategories()
        .then((data) => {
          const items = Array.isArray(data) ? data : data?.items ?? [];
          setCategories(
            items.map((item: { id: string; name: string; parentId?: string | null; displayOrder?: number }) => ({
              id: item.id,
              name: item.name,
              parentId: item.parentId ?? null,
              displayOrder: item.displayOrder ?? 0,
            })),
          );
        })
        .catch((reason) => setError(apiError(reason, "Department / category list could not be loaded.")));
    };
    loadCategories();
    getRoles()
      .then((data) => setGroupOptions((Array.isArray(data) ? data : []).map((item: { id: string; name?: string }) => ({ id: item.id, name: item.name || item.id }))))
      .catch((reason) => setError(apiError(reason, "Groups list could not be loaded.")));
    getAllAdminUsers()
      .then((data) => setUserOptions((Array.isArray(data) ? data : []).map((item: { id: string; name?: string; email?: string }) => ({ id: item.id, name: item.name || item.email || item.id, hint: item.email }))))
      .catch((reason) => setError(apiError(reason, "Users list could not be loaded.")));
    const onAdminChanged = () => {
      loadCategories();
      getRoles()
        .then((data) =>
          setGroupOptions((Array.isArray(data) ? data : []).map((item: { id: string; name?: string }) => ({ id: item.id, name: item.name || item.id }))),
        )
        .catch(() => undefined);
    };
    window.addEventListener("portal:admin-changed", onAdminChanged);
    return () => window.removeEventListener("portal:admin-changed", onAdminChanged);
    // Initial catalog load only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const clearLinks = () => {
    setCategoryTag([]);
    setGroupTags([]);
    setUserTags([]);
    setSavedGroups([]);
    setSavedUsers([]);
  };

  const openCreate = () => {
    setDraft(blank);
    clearLinks();
    chooseProvider(DEFAULT_REPORT_PROVIDER);
    setEditing(true);
    setAcl(null);
    setNotice(null);
  };

  const openEdit = (row: ReportRow) => {
    setMenuId(null);
    setAcl(null);
    const appType = (row as ReportRow & { applicationType?: string }).applicationType ?? DEFAULT_REPORT_PROVIDER;
    chooseProvider(appType === "fabric-rayfin" ? "fabric-rayfin" : DEFAULT_REPORT_PROVIDER);
    setDraft({
      id: row.id,
      name: row.title || row.name || "",
      description: row.description || "",
      reportCategory: row.categoryId || "",
      powerBiReportId: row.powerBiReportId || "",
      semanticModelId: row.semanticModelId || "",
      powerWorkSpaceId: row.workspaceId || row.powerWorkSpaceId || "",
      rlsEnabled: Boolean(row.rlsEnabled),
      enablePagination: Boolean(row.enablePagination),
      roles: (row.powerBiRlsRole ?? []).map((role) => ({ id: role.id, rlsRole: role.rlsRole })),
    });
    setCategoryTag(row.categoryId ? [{ id: row.categoryId, name: row.categoryName || row.categoryId }] : []);
    setGroupTags([]);
    setUserTags([]);
    setSavedGroups([]);
    setSavedUsers([]);
    setEditing(true);
    getAdminReport(row.id)
      .then((detail: {
        assignedGroup?: { group?: string; groupId?: string; mappingGroupId?: string }[];
        assignedUsers?: { user?: string; userEmail?: string; userId?: string; mappingUserId?: string }[];
        reportCategory?: { id?: string; name?: string };
        semanticModelId?: string;
        applicationType?: string;
        hostingUrl?: string;
        fabricAppId?: string;
        workspaceId?: string;
      }) => {
        setDraft((current) => ({ ...current, semanticModelId: detail.semanticModelId ?? "" }));
        if (detail.applicationType === "fabric-rayfin") {
          setProviderValues({
            hostingUrl: detail.hostingUrl ?? "",
            workspaceId: detail.workspaceId ?? "",
            appId: detail.fabricAppId ?? "",
          });
        }
        const groups = (detail.assignedGroup ?? [])
          .filter((item) => item.groupId)
          .map((item) => ({ id: item.groupId as string, name: item.group || (item.groupId as string), mappingId: item.mappingGroupId }));
        const people = (detail.assignedUsers ?? [])
          .filter((item) => item.userId)
          .map((item) => ({ id: item.userId as string, name: item.user || item.userEmail || (item.userId as string), hint: item.userEmail, mappingId: item.mappingUserId }));
        setGroupTags(groups);
        setSavedGroups(groups);
        setUserTags(people);
        setSavedUsers(people);
        if (detail.reportCategory?.id) {
          setCategoryTag([{ id: detail.reportCategory.id, name: detail.reportCategory.name || detail.reportCategory.id }]);
        }
      })
      .catch(() => undefined);
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    const categoryId = categoryTag[0]?.id ?? "";
    if (provider !== DEFAULT_REPORT_PROVIDER) {
      const errors = validateProviderConfig(PROVIDER_CONFIG_FIELDS[provider], providerValues);
      if (!draft.name.trim()) errors.name = "Name is required.";
      if (!categoryId) errors.category = "Department / Category is required.";
      setProviderErrors(errors);
      if (Object.keys(errors).length > 0) {
        setError("Fix the highlighted fields.");
        return;
      }
      if (provider !== "fabric-rayfin") {
        setError(null);
        setNotice(
          `${getReportProvider(provider)?.label} configuration is valid. Saving this app type is not enabled yet.`,
        );
        return;
      }
      const guid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      const workspace = String(providerValues.workspaceId ?? "").trim();
      const rayfinAppId = String(providerValues.appId ?? "").trim();
      const hostingUrl = String(providerValues.hostingUrl ?? "").trim();
      if (!hostingUrl || !workspace || !rayfinAppId) {
        setError("Hosting URL, Fabric workspace ID, and Rayfin app ID are required.");
        return;
      }
      if (!guid.test(categoryId) || !guid.test(workspace) || !guid.test(rayfinAppId)) {
        setError("Category, workspace ID and Rayfin app ID must be valid GUIDs.");
        return;
      }
      setSaving(true);
      setError(null);
      const reportId = draft.id || crypto.randomUUID();
      const roles = draft.rlsEnabled ? draft.roles.map((role) => role.rlsRole).filter(Boolean) : [];
      const fabricPayload = {
        id: reportId,
        name: draft.name.trim(),
        description: draft.description.trim(),
        reportCategory: categoryId,
        applicationType: provider,
        hostingUrl,
        powerWorkSpaceId: workspace,
        fabricAppId: rayfinAppId,
        semanticModelId: String(providerValues.semanticModelId ?? draft.semanticModelId ?? "").trim() || undefined,
        rlsEnabled: draft.rlsEnabled,
        enablePagination: false,
        powerBiRlsRole: draft.rlsEnabled
          ? draft.roles.map((role) => ({ id: role.id && guid.test(role.id) ? role.id : EMPTY, rlsRole: role.rlsRole }))
          : [],
      };
      try {
        if (draft.id) await editReport(reportId, fabricPayload);
        else await addReport(fabricPayload);
        for (const saved of savedGroups) {
          if (!groupTags.some((tag) => tag.id === saved.id) && saved.mappingId) await unmapReportGroup(reportId, saved.mappingId);
        }
        for (const tag of groupTags) await mapReportGroup(reportId, tag.id, roles);
        for (const saved of savedUsers) {
          if (!userTags.some((tag) => tag.id === saved.id) && saved.mappingId) await unmapReportUser(reportId, saved.mappingId);
        }
        for (const tag of userTags) await mapReportUser(reportId, tag.id, roles);
        setEditing(false);
        setDraft(blank);
        clearLinks();
        notifyAdminChanged();
        load();
      } catch (reason) {
        setError(apiError(reason, "Could not save the Fabric Rayfin app."));
      } finally {
        setSaving(false);
      }
      return;
    }
    const fieldErrors: string[] = [];
    if (!draft.name.trim()) fieldErrors.push("Report name is required.");
    if (!categoryId) fieldErrors.push("Select a department / category from the list (search and click a row).");
    if (!draft.powerBiReportId.trim()) fieldErrors.push("Power BI report GUID is required.");
    if (!draft.powerWorkSpaceId.trim()) fieldErrors.push("Power BI workspace GUID is required.");
    if (!draft.semanticModelId.trim()) fieldErrors.push("Semantic model ID is required.");
    if (fieldErrors.length) {
      setError(fieldErrors.join(" "));
      return;
    }
    const guid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (
      !guid.test(categoryId) ||
      !guid.test(draft.powerBiReportId.trim()) ||
      !guid.test(draft.powerWorkSpaceId.trim()) ||
      !guid.test(draft.semanticModelId.trim())
    ) {
      setError("Category, Power BI report ID, workspace ID and semantic model ID must be valid GUIDs.");
      return;
    }
    setSaving(true);
    setError(null);
    const reportId = draft.id || crypto.randomUUID();
    const roles = draft.rlsEnabled ? draft.roles.map((role) => role.rlsRole).filter(Boolean) : [];
    const payload = {
      id: reportId,
      name: draft.name.trim(),
      description: draft.description.trim(),
      reportCategory: categoryId,
      powerBiReportId: draft.powerBiReportId.trim(),
      semanticModelId: draft.semanticModelId.trim(),
      applicationType: provider,
      powerWorkSpaceId: draft.powerWorkSpaceId.trim(),
      rlsEnabled: draft.rlsEnabled,
      enablePagination: draft.enablePagination,
      powerBiRlsRole: draft.rlsEnabled
        ? draft.roles.map((role) => ({ id: role.id && guid.test(role.id) ? role.id : EMPTY, rlsRole: role.rlsRole }))
        : [],
    };
    try {
      if (draft.id) await editReport(reportId, payload);
      else await addReport(payload);
      setDraft((current) => ({ ...current, id: reportId, reportCategory: categoryId }));
      for (const saved of savedGroups) {
        if (!groupTags.some((tag) => tag.id === saved.id) && saved.mappingId) await unmapReportGroup(reportId, saved.mappingId);
      }
      for (const tag of groupTags) await mapReportGroup(reportId, tag.id, roles);
      for (const saved of savedUsers) {
        if (!userTags.some((tag) => tag.id === saved.id) && saved.mappingId) await unmapReportUser(reportId, saved.mappingId);
      }
      for (const tag of userTags) await mapReportUser(reportId, tag.id, roles);
      if (!draft.id && groupTags.length === 0 && userTags.length === 0) {
        setNotice(
          "Report created. Assign at least one group or user under access mapping so viewers see it in the menu.",
        );
      } else {
        setNotice(null);
      }
      setEditing(false);
      setDraft(blank);
      clearLinks();
      notifyAdminChanged();
      load();
    } catch (reason) {
      setError(apiError(reason, "Could not save the report."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <AdminScreen title="Manage Reports">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {error && <p className="mb-2 shrink-0 text-sm text-red-600">{error}</p>}
        {notice && !editing && <p className="mb-2 shrink-0 text-sm text-amber-700">{notice}</p>}
        <AdminToolbar
          search={search}
          onSearch={setSearch}
          searchPlaceholder="Search by Report Name"
          onSearchClick={() => {
            setAppliedSearch(search);
            setAppliedCategory(category);
            load(1, pageSize, search, category);
          }}
          addLabel="ADD NEW"
          onAdd={openCreate}
          filter={
            <select
              className="h-10 min-w-[220px] rounded-md border bg-background px-3 text-sm"
              value={category}
              onChange={(event) => setCategory(event.target.value)}
            >
              <option value="">Search by Department / Category</option>
              {toTreeTagOptions(categories).map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          }
        />
        <div
          className={
            editing
              ? "min-h-0 max-h-full flex-1 overflow-y-auto overscroll-contain pb-2 lg:overflow-y-visible"
              : "flex min-h-0 flex-1 flex-col overflow-hidden"
          }
        >
          {editing ? (
            <AdminReportForm
              draft={draft}
              setDraft={setDraft}
              provider={provider}
              onProviderChange={chooseProvider}
              providerValues={providerValues}
              onProviderValuesChange={setProviderValues}
              providerErrors={providerErrors}
              categories={toTreeTagOptions(categories)}
              categoryTag={categoryTag}
              setCategoryTag={setCategoryTag}
              groupOptions={groupOptions}
              groupTags={groupTags}
              setGroupTags={setGroupTags}
              userOptions={userOptions}
              userTags={userTags}
              setUserTags={setUserTags}
              roleName={roleName}
              setRoleName={setRoleName}
              saving={saving}
              notice={notice}
              onCancel={() => setEditing(false)}
              onSubmit={save}
            />
          ) : (
            <>
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full table-fixed text-[13px]">
            <thead className="sticky top-0 z-10 bg-muted text-left text-muted-foreground">
              <tr>
                <th className="w-12 px-2 py-1 font-medium">SN</th>
                <th className="px-2 py-1 font-medium">Report Name</th>
                <th className="px-2 py-1 font-medium">Department/Category</th>
                <th className="w-16 px-2 py-1 font-medium">RLS</th>
                <th className="w-24 px-2 py-1 font-medium">Pagination</th>
                <th className="w-10 px-2 py-1" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={row.id} className="border-t">
                  <td className="px-2 py-1">{(page - 1) * pageSize + index + 1}</td>
                  <td className="truncate px-2 py-1">{row.title || row.name}</td>
                  <td className="truncate px-2 py-1">{row.categoryName || "—"}</td>
                  <td className="px-2 py-1"><Flag on={Boolean(row.rlsEnabled)} /></td>
                  <td className="px-2 py-1"><Flag on={Boolean(row.enablePagination)} /></td>
                  <td className="px-2 py-1">
                    <RowMenu
                      open={menuId === row.id}
                      onToggle={() => setMenuId(menuId === row.id ? null : row.id)}
                      actions={[
                        { label: "Edit", onClick: () => openEdit(row) },
                        { label: "Page ACL", onClick: () => { setMenuId(null); setAcl(row); setEditing(false); } },
                        {
                          label: "Delete",
                          onClick: () => {
                            setMenuId(null);
                            if (!window.confirm(`Delete ${row.title || row.name}?`)) return;
                            deleteReport(row.id)
                              .then(() => {
                                notifyAdminChanged();
                                load();
                              })
                              .catch((reason) => setError(apiError(reason, "Could not delete the report.")));
                          },
                        },
                      ]}
                    />
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-8 text-center text-slate-500">No reports found.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <AdminPager
          page={page}
          totalPages={totalPages}
          pageSize={pageSize}
          onPage={(next) => load(next)}
          onPageSize={(size) => {
            setPageSize(size);
            load(1, size);
          }}
        />
        {acl && (
          <div className="mt-6 rounded border p-4">
            <h3 className="mb-3 font-semibold">Page Permissions — {acl.title || acl.name}</h3>
            <ReportPagePermissions
              reportId={acl.id}
              workspaceId={acl.workspaceId || acl.powerWorkSpaceId || ""}
              powerBiReportId={acl.powerBiReportId || ""}
            />
          </div>
        )}
            </>
          )}
        </div>
      </div>
    </AdminScreen>
  );
}
