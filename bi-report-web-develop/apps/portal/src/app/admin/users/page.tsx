"use client";

import { useEffect, useState } from "react";
import { Button } from "@/modules/shared/components/ui/button";
import { Input } from "@/modules/shared/components/ui/input";
import { BulkUserImport } from "@/modules/admin/components/BulkUserImport";
import { AdminPager, AdminScreen, AdminToolbar, RowMenu, TagPicker, apiError, notifyAdminChanged, readPage, type TagOption } from "@/modules/admin/components/AdminChrome";
import { addUser, deleteUser, editUser, getRoles, getUsers } from "@/services/biServices";

type GroupRef = { id: string; name?: string };
type UserRow = { id: string; name: string; email: string; group?: GroupRef[] };
type GroupOption = { id: string; name: string };

export default function AdminUsersPage() {
  const [rows, setRows] = useState<UserRow[]>([]);
  const [groups, setGroups] = useState<GroupOption[]>([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [totalPages, setTotalPages] = useState(1);
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [showBulk, setShowBulk] = useState(false);
  const [editing, setEditing] = useState(false);
  const [userId, setUserId] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [groupTags, setGroupTags] = useState<TagOption[]>([]);
  const [sendMail, setSendMail] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = (nextPage = page, nextSize = pageSize, nextSearch = appliedSearch) => {
    setError(null);
    getUsers({ page: nextPage, pageSize: nextSize, search: nextSearch })
      .then((data) => {
        const result = readPage<UserRow>(data);
        setRows(result.items);
        setPage(result.page);
        setTotalPages(result.totalPages);
      })
      .catch((reason) => setError(apiError(reason, "Users could not be loaded.")));
  };

  const loadGroupOptions = () => {
    getRoles()
      .then((data) => setGroups(Array.isArray(data) ? data : data?.items ?? []))
      .catch((reason) => setError(apiError(reason, "Groups list could not be loaded.")));
  };

  useEffect(() => {
    load(1, 20, "");
    loadGroupOptions();
    const onAdminChanged = () => loadGroupOptions();
    window.addEventListener("portal:admin-changed", onAdminChanged);
    return () => window.removeEventListener("portal:admin-changed", onAdminChanged);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openCreate = () => {
    setUserId("");
    setName("");
    setEmail("");
    setGroupTags([]);
    setSendMail(true);
    setEditing(true);
    setShowBulk(false);
  };

  const openEdit = (row: UserRow) => {
    setMenuId(null);
    setUserId(row.id);
    setName(row.name || "");
    setEmail(row.email || "");
    setGroupTags((row.group ?? []).filter((group) => group.id).map((group) => ({ id: group.id, name: group.name || group.id })));
    setSendMail(false);
    setEditing(true);
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim() || !email.trim()) return;
    setSaving(true);
    setError(null);
    const payload = {
      id: userId || crypto.randomUUID(),
      name: name.trim(),
      emailAddress: email.trim(),
      group: groupTags.map((group) => group.id),
      sendMail,
    };
    try {
      if (userId) await editUser(userId, payload);
      else await addUser(payload);
      setEditing(false);
      notifyAdminChanged();
      load();
    } catch (reason) {
      setError(apiError(reason, "Could not save the user."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <AdminScreen title="Manage Users">
        {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
        <div className="mb-3 flex justify-end">
          <Button variant="outline" onClick={() => { setShowBulk((open) => !open); setEditing(false); }}>
            {showBulk ? "Hide Bulk Import" : "Bulk Import Users"}
          </Button>
        </div>
        <AdminToolbar
          search={search}
          onSearch={setSearch}
          searchPlaceholder="Search by User Name/Email"
          onSearchClick={() => {
            setAppliedSearch(search);
            load(1, pageSize, search);
          }}
          addLabel="ADD USER"
          onAdd={openCreate}
        />
        {showBulk && (
          <div className="mb-6 rounded border p-4">
            <BulkUserImport onComplete={() => load()} />
          </div>
        )}
        {editing && (
          <form onSubmit={save} className="mb-2 shrink-0 space-y-2 rounded border p-3">
            <p className="text-sm font-semibold">{userId ? "Edit user" : "Add user"}</p>
            <div className="grid grid-cols-2 gap-2">
              <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Full name" required />
              <Input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Email address" type="email" required />
            </div>
            <TagPicker
              label="Groups"
              placeholder="Search groups"
              options={groups.map((group) => ({ id: group.id, name: group.name }))}
              selected={groupTags}
              onChange={setGroupTags}
            />
            {!userId && (
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={sendMail} onChange={(event) => setSendMail(event.target.checked)} />
                Send invitation email
              </label>
            )}
            <div className="flex gap-2">
              <Button type="submit" disabled={saving}>{saving ? "Saving…" : userId ? "Save user" : "Create user"}</Button>
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
                <th className="px-2 py-1 font-medium">Email</th>
                <th className="px-2 py-1 font-medium">Groups</th>
                <th className="w-10 px-2 py-1" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => {
                const names = (row.group ?? []).map((group) => group.name).filter(Boolean) as string[];
                const visible = expanded === row.id ? names : names.slice(0, 1);
                return (
                  <tr key={row.id} className="border-t">
                    <td className="truncate px-2 py-1">{(page - 1) * pageSize + index + 1}</td>
                    <td className="truncate px-2 py-1">{row.name}</td>
                    <td className="truncate px-2 py-1">{row.email}</td>
                    <td className="truncate px-2 py-1">
                      {visible.join(", ") || "—"}
                      {names.length > 1 && (
                        <button type="button" className="ml-2 text-indigo-600 underline" onClick={() => setExpanded(expanded === row.id ? null : row.id)}>
                          {expanded === row.id ? "Less" : "More"}
                        </button>
                      )}
                    </td>
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
                              deleteUser(row.id)
                                .then(() => {
                                  notifyAdminChanged();
                                  load();
                                })
                                .catch((reason) => setError(apiError(reason, "Could not delete the user.")));
                            },
                          },
                        ]}
                      />
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-8 text-center text-slate-500">No users found.</td>
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
    </AdminScreen>
  );
}
