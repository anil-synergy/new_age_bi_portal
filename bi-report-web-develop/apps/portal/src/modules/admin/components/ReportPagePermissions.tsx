"use client";

import { useEffect, useState } from "react";
import { Button } from "@/modules/shared/components/ui/button";
import { fetchReportPages } from "@/services/pbiEmbedService";
import { getReportPageACL, updateReportPageACL } from "@/services/biServices";
import type { PageACL, PageMeta } from "@/types";

interface ReportPagePermissionsProps {
  reportId: string;
  workspaceId: string;
  powerBiReportId: string;
}

export function ReportPagePermissions({ reportId, workspaceId, powerBiReportId }: ReportPagePermissionsProps) {
  const [pages, setPages] = useState<PageACL[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const [pbiPages, acl] = await Promise.all([
          fetchReportPages(workspaceId, powerBiReportId).catch(() => [] as PageMeta[]),
          getReportPageACL(reportId).catch(() => [] as PageACL[]),
        ]);
        const merged: PageACL[] = pbiPages.map((p) => {
          const existing = acl.find((a) => a.pageName === p.name);
          return existing ?? {
            reportId,
            pageName: p.name,
            displayName: p.displayName,
            allowedUserIds: [],
            allowedGroupIds: [],
          };
        });
        setPages(merged.length ? merged : acl);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [reportId, workspaceId, powerBiReportId]);

  const save = async () => {
    setSaving(true);
    try {
      await updateReportPageACL(reportId, pages);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <p className="text-sm text-slate-500">Loading pages…</p>;

  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600">
        Configure which pages are visible to users/groups. Leave restrictions empty to allow all.
      </p>
      {pages.map((page, idx) => (
        <div key={page.pageName} className="rounded border p-3">
          <p className="font-medium text-sm">{page.displayName}</p>
          <p className="text-xs text-slate-400">Page ID: {page.pageName}</p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <div>
              <label className="text-xs text-slate-500">Allowed User IDs (comma-separated)</label>
              <input
                className="mt-1 w-full rounded border px-2 py-1 text-sm"
                value={(page.allowedUserIds ?? []).join(", ")}
                onChange={(e) => {
                  const updated = [...pages];
                  updated[idx] = {
                    ...page,
                    allowedUserIds: e.target.value.split(",").map((s) => s.trim()).filter(Boolean),
                  };
                  setPages(updated);
                }}
              />
            </div>
            <div>
              <label className="text-xs text-slate-500">Allowed Group IDs (comma-separated)</label>
              <input
                className="mt-1 w-full rounded border px-2 py-1 text-sm"
                value={(page.allowedGroupIds ?? []).join(", ")}
                onChange={(e) => {
                  const updated = [...pages];
                  updated[idx] = {
                    ...page,
                    allowedGroupIds: e.target.value.split(",").map((s) => s.trim()).filter(Boolean),
                  };
                  setPages(updated);
                }}
              />
            </div>
          </div>
        </div>
      ))}
      <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save page permissions"}</Button>
    </div>
  );
}
