"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/modules/shared/components/ui/button";
import { Input } from "@/modules/shared/components/ui/input";
import type { ManualReportConfig } from "@/types";

const STORAGE_KEY = "manual-report-config";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function loadManualReportFromSession(): ManualReportConfig | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as ManualReportConfig) : null;
  } catch {
    return null;
  }
}

export function saveManualReportToSession(config: ManualReportConfig | null) {
  if (typeof window === "undefined") return;
  if (config) {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } else {
    sessionStorage.removeItem(STORAGE_KEY);
  }
}

interface ReportLoadFormProps {
  onLoad: (config: ManualReportConfig | null) => void;
  initialConfig?: ManualReportConfig | null;
}

export function ReportLoadForm({ onLoad, initialConfig }: ReportLoadFormProps) {
  const searchParams = useSearchParams();
  const [workspaceId, setWorkspaceId] = useState(initialConfig?.workspaceId ?? "");
  const [reportId, setReportId] = useState(initialConfig?.reportId ?? "");
  const [datasetId, setDatasetId] = useState(initialConfig?.datasetId ?? "");
  const [rlsUsername, setRlsUsername] = useState(initialConfig?.rlsUsername ?? "");
  const [rlsRole, setRlsRole] = useState(initialConfig?.rlsRole ?? "");
  const [showRls, setShowRls] = useState(Boolean(initialConfig?.rlsUsername || initialConfig?.rlsRole));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const queryLoaded = useRef(false);

  useEffect(() => {
    if (queryLoaded.current) return;
    const ws = searchParams.get("workspace");
    const rp = searchParams.get("report");
    const ds = searchParams.get("dataset");
    if (!ws && !rp && !ds) return;

    queryLoaded.current = true;
    if (ws) setWorkspaceId(ws);
    if (rp) setReportId(rp);
    if (ds) setDatasetId(ds);
    const rlsUser = searchParams.get("rlsUser");
    const rlsRl = searchParams.get("rlsRole");
    if (rlsUser) setRlsUsername(rlsUser);
    if (rlsRl) setRlsRole(rlsRl);
    if (rlsUser || rlsRl) setShowRls(true);

    if (ws && rp && ds && UUID_REGEX.test(ws) && UUID_REGEX.test(rp) && UUID_REGEX.test(ds)) {
      const config: ManualReportConfig = {
        workspaceId: ws,
        reportId: rp,
        datasetId: ds,
        rlsUsername: rlsUser || undefined,
        rlsRole: rlsRl || undefined,
      };
      saveManualReportToSession(config);
      onLoad(config);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const validate = (): ManualReportConfig | null => {
    const next: Record<string, string> = {};
    if (!UUID_REGEX.test(workspaceId.trim())) next.workspaceId = "Valid workspace UUID required";
    if (!UUID_REGEX.test(reportId.trim())) next.reportId = "Valid report UUID required";
    if (!UUID_REGEX.test(datasetId.trim())) next.datasetId = "Valid dataset UUID required";
    if (showRls && rlsUsername && !rlsRole.trim()) next.rlsRole = "RLS role required when email is set";
    if (showRls && rlsRole && !rlsUsername.trim()) next.rlsUsername = "RLS email required when role is set";
    setErrors(next);
    if (Object.keys(next).length > 0) return null;

    return {
      workspaceId: workspaceId.trim(),
      reportId: reportId.trim(),
      datasetId: datasetId.trim(),
      rlsUsername: rlsUsername.trim() || undefined,
      rlsRole: rlsRole.trim() || undefined,
    };
  };

  const handleLoad = () => {
    const config = validate();
    if (!config) return;
    saveManualReportToSession(config);
    onLoad(config);
  };

  const handleClear = () => {
    setWorkspaceId("");
    setReportId("");
    setDatasetId("");
    setRlsUsername("");
    setRlsRole("");
    setErrors({});
    saveManualReportToSession(null);
    onLoad(null);
  };

  return (
    <div className="border-b bg-white p-4 shadow-sm">
      <div className="mx-auto grid max-w-5xl gap-3 sm:grid-cols-3">
        <div>
          <label className="text-xs font-medium text-slate-600">Workspace ID</label>
          <Input
            value={workspaceId}
            onChange={(e) => setWorkspaceId(e.target.value)}
            placeholder="00000000-0000-0000-0000-000000000000"
            className={errors.workspaceId ? "border-red-500" : ""}
          />
          {errors.workspaceId && <p className="mt-1 text-xs text-red-500">{errors.workspaceId}</p>}
        </div>
        <div>
          <label className="text-xs font-medium text-slate-600">Report ID</label>
          <Input
            value={reportId}
            onChange={(e) => setReportId(e.target.value)}
            placeholder="00000000-0000-0000-0000-000000000000"
            className={errors.reportId ? "border-red-500" : ""}
          />
          {errors.reportId && <p className="mt-1 text-xs text-red-500">{errors.reportId}</p>}
        </div>
        <div>
          <label className="text-xs font-medium text-slate-600">Dataset ID</label>
          <Input
            value={datasetId}
            onChange={(e) => setDatasetId(e.target.value)}
            placeholder="00000000-0000-0000-0000-000000000000"
            className={errors.datasetId ? "border-red-500" : ""}
          />
          {errors.datasetId && <p className="mt-1 text-xs text-red-500">{errors.datasetId}</p>}
        </div>
      </div>

      <div className="mx-auto mt-3 max-w-5xl">
        <button
          type="button"
          className="flex items-center gap-1 text-xs text-slate-600 hover:text-primary"
          onClick={() => setShowRls(!showRls)}
        >
          {showRls ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          Optional RLS (row-level security)
        </button>
        {showRls && (
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            <div>
              <label className="text-xs font-medium text-slate-600">RLS user email</label>
              <Input
                value={rlsUsername}
                onChange={(e) => setRlsUsername(e.target.value)}
                placeholder="user@synergyship.com"
                className={errors.rlsUsername ? "border-red-500" : ""}
              />
              {errors.rlsUsername && <p className="mt-1 text-xs text-red-500">{errors.rlsUsername}</p>}
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600">RLS role</label>
              <Input
                value={rlsRole}
                onChange={(e) => setRlsRole(e.target.value)}
                placeholder="BS_User"
                className={errors.rlsRole ? "border-red-500" : ""}
              />
              {errors.rlsRole && <p className="mt-1 text-xs text-red-500">{errors.rlsRole}</p>}
            </div>
          </div>
        )}
      </div>

      <div className="mx-auto mt-4 flex max-w-5xl gap-2">
        <Button onClick={handleLoad}>Load Report</Button>
        <Button variant="outline" onClick={handleClear}>Clear</Button>
      </div>
    </div>
  );
}
