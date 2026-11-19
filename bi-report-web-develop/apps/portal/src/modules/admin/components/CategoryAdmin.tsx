"use client";

import { useEffect, useState } from "react";
import { Button } from "@/modules/shared/components/ui/button";
import { Input } from "@/modules/shared/components/ui/input";
import { AdminPager, AdminScreen, AdminToolbar, RowMenu, TagPicker, apiError, notifyAdminChanged, readPage, type TagOption } from "./AdminChrome";
import { addCategory, deleteCategory, editCategory, getAllAdminUsers, getCategories, getCategoriesPaged } from "@/services/biServices";
import {
  buildCategoryLookup,
  isCategoryDescendant,
  toTreeTagOptions,
  type FlatCategory,
} from "@/modules/admin/utils/category-tree";

const EMPTY_GUID = "00000000-0000-0000-0000-000000000000";

function departmentAdmins(admins: unknown[]) {
  return admins.flatMap((item) => {
    if (!item || typeof item !== "object" || !("id" in item)) return [];
    const row = item as { id?: string; name?: string; email?: string };
    if (!row.id || row.id === EMPTY_GUID) return [];
    return [{ id: row.id, name: row.name ?? "", email: row.email ?? "" }];
  });
}

type CategoryRow = {
  id: string;
  name: string;
  description?: string;
  path?: string;
  parentId?: string | null;
  displayOrder?: number;
  departmentAdmin?: unknown[];
};
type UserOption = { id: string; name?: string; email?: string };

export function CategoryAdmin({ title, addLabel }: { title: string; addLabel: string }) {
  const [rows, setRows] = useState<CategoryRow[]>([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [totalPages, setTotalPages] = useState(1);
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [editing, setEditing] = useState(false);
  const [categoryId, setCategoryId] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [admins, setAdmins] = useState<TagOption[]>([]);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [allCategories, setAllCategories] = useState<FlatCategory[]>([]);
  const [parentTag, setParentTag] = useState<TagOption[]>([]);
  const [displayOrder, setDisplayOrder] = useState(0);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = (nextPage = page, nextSize = pageSize, nextSearch = appliedSearch) => {
    setError(null);
    getCategoriesPaged({ page: nextPage, pageSize: nextSize, search: nextSearch })
      .then((data) => {
        const result = readPage<CategoryRow>(data);
        setRows(result.items);
        setPage(result.page);
        setTotalPages(result.totalPages);
      })
      .catch((reason) => setError(apiError(reason, "Categories could not be loaded.")));
  };

  const refreshAllCategories = () => {
    getCategories()
      .then((data) => {
        const items = Array.isArray(data) ? data : data?.items ?? [];
        setAllCategories(
          items.map((item: CategoryRow) => ({
            id: item.id,
            name: item.name,
            parentId: item.parentId ?? null,
            displayOrder: item.displayOrder ?? 0,
          })),
        );
      })
      .catch((reason) => setError(apiError(reason, "Department / category list could not be loaded.")));
  };

  useEffect(() => {
    load(1, 20, "");
    refreshAllCategories();
    getAllAdminUsers()
      .then((data) => setUsers(Array.isArray(data) ? data : []))
      .catch(() => undefined);
    const onAdminChanged = () => refreshAllCategories();
    window.addEventListener("portal:admin-changed", onAdminChanged);
    return () => window.removeEventListener("portal:admin-changed", onAdminChanged);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const parentFolderOptions = () => {
    const lookup = buildCategoryLookup(allCategories);
    const exclude = categoryId
      ? [
          categoryId,
          ...allCategories
            .filter((c) => isCategoryDescendant(lookup, categoryId, c.id))
            .map((c) => c.id),
        ]
      : [];
    return toTreeTagOptions(allCategories, exclude);
  };

  const openCreate = () => {
    setCategoryId("");
    setName("");
    setDescription("");
    setAdmins([]);
    setParentTag([]);
    setDisplayOrder(0);
    setEditing(true);
  };

  const openEdit = (row: CategoryRow) => {
    setMenuId(null);
    setCategoryId(row.id);
    setName(row.name || "");
    setDescription(row.description || "");
    setDisplayOrder(row.displayOrder ?? 0);
    setParentTag(
      row.parentId
        ? [
            {
              id: row.parentId,
              name: allCategories.find((c) => c.id === row.parentId)?.name ?? row.parentId,
            },
          ]
        : [],
    );
    setAdmins(departmentAdmins(row.departmentAdmin ?? []).map((admin) => ({ id: admin.id, name: admin.name || admin.email || admin.id, hint: admin.email })));
    setEditing(true);
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    setError(null);
    const payload = {
      id: categoryId || EMPTY_GUID,
      name: name.trim(),
      description: description.trim(),
      parentId: parentTag[0]?.id ?? null,
      displayOrder,
      departmentAdmin: admins.map((admin) => ({ id: admin.id, name: admin.name, email: admin.hint ?? "" })),
    };
    try {
      if (categoryId) await editCategory(categoryId, payload);
      else await addCategory(payload);
      setEditing(false);
      notifyAdminChanged();
      load();
    } catch (reason) {
      setError(apiError(reason, "Could not save the category."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <AdminScreen title={title}>
        {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
        <AdminToolbar
          search={search}
          onSearch={setSearch}
          searchPlaceholder="Search by Name"
          onSearchClick={() => {
            setAppliedSearch(search);
            load(1, pageSize, search);
          }}
          addLabel={addLabel}
          onAdd={openCreate}
        />
        {editing && (
          <form onSubmit={save} className="mb-2 grid shrink-0 grid-cols-2 gap-2 rounded border p-3">
            <p className="col-span-2 text-sm font-semibold">{categoryId ? "Edit" : "Add"}</p>
            <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Name" required />
            <Input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Description" />
            <TagPicker
              label="Parent folder (optional)"
              placeholder="Root level"
              multiple={false}
              options={parentFolderOptions()}
              selected={parentTag}
              onChange={setParentTag}
            />
            <Input
              type="number"
              value={displayOrder}
              onChange={(event) => setDisplayOrder(Number(event.target.value) || 0)}
              placeholder="Display order"
              title="Sort order among siblings in the menu"
            />
            <div className="col-span-2">
              <TagPicker
                label="Users"
                placeholder="Search users"
                options={users.filter((user) => user.id).map((user) => ({ id: user.id, name: user.name || user.email || user.id, hint: user.email }))}
                selected={admins}
                onChange={setAdmins}
              />
            </div>
            <div className="col-span-2 flex gap-2">
              <Button type="submit" disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
              <Button type="button" variant="outline" onClick={() => setEditing(false)}>Cancel</Button>
            </div>
          </form>
        )}
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full table-fixed text-[13px]">
            <thead className="sticky top-0 z-10 bg-muted text-left text-muted-foreground">
              <tr>
                <th className="w-12 px-2 py-1 font-medium">SN</th>
                <th className="px-2 py-1 font-medium">Name</th>
                <th className="px-2 py-1 font-medium">Menu path</th>
                <th className="px-2 py-1 font-medium">Description</th>
                <th className="w-10 px-2 py-1" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={row.id} className="border-t">
                  <td className="px-2 py-1">{(page - 1) * pageSize + index + 1}</td>
                  <td className="truncate px-2 py-1">{row.name}</td>
                  <td className="truncate px-2 py-1 text-muted-foreground">{row.path || row.name}</td>
                  <td className="truncate px-2 py-1">{row.description || "—"}</td>
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
                            deleteCategory(row.id)
                              .then(() => {
                                notifyAdminChanged();
                                load();
                              })
                              .catch((reason) => setError(apiError(reason, "Could not delete.")));
                          },
                        },
                      ]}
                    />
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={5} className="px-3 py-8 text-center text-slate-500">Nothing found.</td></tr>
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
