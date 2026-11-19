"use client";

import { useEffect, useState } from "react";
import { Button } from "@/modules/shared/components/ui/button";
import { Input } from "@/modules/shared/components/ui/input";
import { AdminPager, AdminScreen, AdminToolbar, RowMenu, TagPicker, apiError, notifyAdminChanged, readPage, type TagOption } from "@/modules/admin/components/AdminChrome";
import { addGroup, deleteGroup, editGroup, getCategories, getGroups } from "@/services/biServices";
import { toTreeTagOptions, type FlatCategory } from "@/modules/admin/utils/category-tree";

type Category = FlatCategory;
type GroupRow = { id: string; name: string; description?: string; reportCategory?: string; reportCategoryName?: string };

export default function AdminGroupsPage() {
  const [rows, setRows] = useState<GroupRow[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [totalPages, setTotalPages] = useState(1);
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [category, setCategory] = useState("");
  const [appliedCategory, setAppliedCategory] = useState("");
  const [editing, setEditing] = useState(false);
  const [groupId, setGroupId] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [categoryTag, setCategoryTag] = useState<TagOption[]>([]);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = (nextPage = page, nextSize = pageSize, nextSearch = appliedSearch, nextCategory = appliedCategory) => {
    setError(null);
    getGroups({ page: nextPage, pageSize: nextSize, search: nextSearch, filterValue: nextCategory })
      .then((data) => {
        const result = readPage<GroupRow>(data);
        setRows(result.items);
        setPage(result.page);
        setTotalPages(result.totalPages);
      })
      .catch((reason) => setError(apiError(reason, "Groups could not be loaded.")));
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
    const onAdminChanged = () => loadCategories();
    window.addEventListener("portal:admin-changed", onAdminChanged);
    return () => window.removeEventListener("portal:admin-changed", onAdminChanged);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openCreate = () => {
    setGroupId("");
    setName("");
    setDescription("");
    setCategoryTag([]);
    setEditing(true);
  };

  const openEdit = (row: GroupRow) => {
    setMenuId(null);
    setGroupId(row.id);
    setName(row.name || "");
    setDescription(row.description || "");
    setCategoryTag(row.reportCategory ? [{ id: row.reportCategory, name: row.reportCategoryName || row.reportCategory }] : []);
    setEditing(true);
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    const categoryId = categoryTag[0]?.id;
    if (!name.trim() || !categoryId) return;
    setSaving(true);
    setError(null);
    const payload = { name: name.trim(), description: description.trim(), reportCategory: categoryId };
    try {
      if (groupId) await editGroup(groupId, payload);
      else await addGroup(payload);
      setEditing(false);
      notifyAdminChanged();
      load();
    } catch (reason) {
      setError(apiError(reason, "Could not save the group."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <AdminScreen title="Manage Groups">
        {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
        <AdminToolbar
          search={search}
          onSearch={setSearch}
          searchPlaceholder="Search by Group Name"
          onSearchClick={() => {
            setAppliedSearch(search);
            setAppliedCategory(category);
            load(1, pageSize, search, category);
          }}
          addLabel="ADD GROUP"
          onAdd={openCreate}
          filter={
            <select className="h-10 min-w-[220px] rounded-md border bg-background px-3 text-sm" value={category} onChange={(event) => setCategory(event.target.value)}>
              <option value="">Search by Department / Category</option>
              {toTreeTagOptions(categories).map((item) => (
                <option key={item.id} value={item.id}>{item.name}</option>
              ))}
            </select>
          }
        />
        {editing && (
          <form onSubmit={save} className="mb-2 grid shrink-0 grid-cols-2 gap-2 rounded border p-3">
            <p className="col-span-2 text-sm font-semibold">{groupId ? "Edit group" : "Add group"}</p>
            <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Group name" required />
            <Input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Description" />
            <div className="col-span-2">
              <TagPicker
                label="Department / Category"
                placeholder="Search department or category"
                multiple={false}
                options={toTreeTagOptions(categories)}
                selected={categoryTag}
                onChange={setCategoryTag}
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Linking a group to a category is for administration only. Map the group on each report (Manage Reports) so members see it in the menu.
              </p>
            </div>
            <div className="col-span-2 flex gap-2">
              <Button type="submit" disabled={saving}>{saving ? "Saving…" : groupId ? "Save group" : "Create group"}</Button>
              <Button type="button" variant="outline" onClick={() => setEditing(false)}>Cancel</Button>
            </div>
          </form>
        )}
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full table-fixed text-[13px]">
            <thead className="sticky top-0 z-10 bg-muted text-left text-muted-foreground">
              <tr>
                <th className="w-12 px-2 py-1 font-medium">SN</th>
                <th className="px-2 py-1 font-medium">Group Name</th>
                <th className="px-2 py-1 font-medium">Description</th>
                <th className="px-2 py-1 font-medium">Department/Category</th>
                <th className="w-10 px-2 py-1" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={row.id} className="border-t">
                  <td className="px-2 py-1">{(page - 1) * pageSize + index + 1}</td>
                  <td className="truncate px-2 py-1">{row.name}</td>
                  <td className="truncate px-2 py-1">{row.description || "—"}</td>
                  <td className="truncate px-2 py-1">{row.reportCategoryName || "—"}</td>
                  <td className="px-2 py-1">
                    <RowMenu
                      open={menuId === row.id}
                      onToggle={() => setMenuId(menuId === row.id ? null : row.id)}
                      actions={[
                        { label: "Edit", onClick: () => openEdit(row) },
                        {
                          label: "Delete",
                          onClick: () => {
                            setMenuId(null);
                            if (!window.confirm(`Delete ${row.name}?`)) return;
                            deleteGroup(row.id)
                              .then(() => {
                                notifyAdminChanged();
                                load();
                              })
                              .catch((reason) => setError(apiError(reason, "Could not delete the group.")));
                          },
                        },
                      ]}
                    />
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={5} className="px-3 py-8 text-center text-slate-500">No groups found.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <AdminPager
          page={page}
          totalPages={totalPages}
          pageSize={pageSize}
          onPage={(next) => load(next)}
          onPageSize={(size) => { setPageSize(size); load(1, size); }}
        />
    </AdminScreen>
  );
}
