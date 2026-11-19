"use client";

import type { FormEvent, ReactNode } from "react";
import { BarChart3, ChevronDown, Info, Users } from "lucide-react";
import { Button } from "@/modules/shared/components/ui/button";
import { Input } from "@/modules/shared/components/ui/input";
import { cn } from "@/lib/utils";
import { ProviderConfigFields } from "@/modules/reports/components/ProviderConfigFields";
import { DEFAULT_REPORT_PROVIDER, REPORT_PROVIDERS, getReportProvider } from "@/modules/reports/providers/registry";
import type { ProviderConfigValues } from "@/modules/reports/providers/config-schema";
import type { ReportProviderId } from "@/modules/reports/providers/types";
import { TagPicker, type TagOption } from "./AdminChrome";
import { ReportProviderIcon } from "./ReportProviderIcon";

const GUID_PLACEHOLDER = "e.g., 00000000-0000-0000-0000-000000000000";
const EMPTY = "00000000-0000-0000-0000-000000000000";

/** Reference spec: navy / teal admin report form. */
const reportFormTheme = {
  navy: "#1d4e89",
  teal: "#0d9488",
  tealHover: "#0f766e",
  tealHeader: "#ecfdf9",
  tealBorder: "#ccebe6",
  infoBanner: "#e7f3fb",
  infoBorder: "#cfe8f5",
  fieldBorder: "#d8e2ec",
  shadow: "0 1px 3px rgba(15, 23, 42, 0.06)",
} as const;

const fieldInputClass =
  "h-9 border-slate-200 text-sm shadow-none focus-visible:ring-[#0d9488]/30";

type RlsRole = { id?: string; rlsRole: string };

export type AdminReportDraft = {
  id: string;
  name: string;
  description: string;
  reportCategory: string;
  powerBiReportId: string;
  semanticModelId: string;
  powerWorkSpaceId: string;
  rlsEnabled: boolean;
  enablePagination: boolean;
  roles: RlsRole[];
};

function FormField({ label, required, children }: { label: string; required?: boolean; children: ReactNode }) {
  return (
    <div className="min-w-0 space-y-1">
      <span className="text-xs font-medium text-slate-700">
        {label}
        {required ? <span className="text-red-500"> *</span> : null}
      </span>
      {children}
    </div>
  );
}

function FormTextarea({ className, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        "flex min-h-[64px] w-full resize-y rounded-md border border-slate-200 bg-white px-3 py-2 text-sm shadow-none placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0d9488]/30 disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

function ApplicationTypeSelect({
  provider,
  disabled,
  isEdit,
  onChange,
}: {
  provider: ReportProviderId;
  disabled: boolean;
  isEdit: boolean;
  onChange: (id: ReportProviderId) => void;
}) {
  return (
    <div className="w-full sm:w-[220px]">
      <label htmlFor="report-app-type" className="sr-only">
        Application type
      </label>
      <div className="relative">
        <div className="pointer-events-none absolute left-2.5 top-1/2 z-10 -translate-y-1/2">
          <ReportProviderIcon id={provider} className="h-4 w-4" />
        </div>
        <select
          id="report-app-type"
          className="h-9 w-full appearance-none rounded-md border border-slate-200 bg-white py-1 pl-9 pr-8 text-sm font-medium text-slate-800 shadow-none disabled:opacity-70"
          value={provider}
          disabled={disabled}
          title={
            isEdit ? "Existing reports are Power BI reports." : getReportProvider(provider)?.description || undefined
          }
          onChange={(event) => onChange(event.target.value as ReportProviderId)}
        >
          {REPORT_PROVIDERS.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </select>
        <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" aria-hidden />
      </div>
    </div>
  );
}

export function AdminReportForm({
  draft,
  setDraft,
  provider,
  onProviderChange,
  providerValues,
  onProviderValuesChange,
  providerErrors,
  categories,
  categoryTag,
  setCategoryTag,
  groupOptions,
  groupTags,
  setGroupTags,
  userOptions,
  userTags,
  setUserTags,
  roleName,
  setRoleName,
  saving,
  notice,
  onCancel,
  onSubmit,
}: {
  draft: AdminReportDraft;
  setDraft: (next: AdminReportDraft | ((current: AdminReportDraft) => AdminReportDraft)) => void;
  provider: ReportProviderId;
  onProviderChange: (id: ReportProviderId) => void;
  providerValues: ProviderConfigValues;
  onProviderValuesChange: (values: ProviderConfigValues) => void;
  providerErrors: Record<string, string>;
  categories: TagOption[];
  categoryTag: TagOption[];
  setCategoryTag: (tags: TagOption[]) => void;
  groupOptions: TagOption[];
  groupTags: TagOption[];
  setGroupTags: (tags: TagOption[]) => void;
  userOptions: TagOption[];
  userTags: TagOption[];
  setUserTags: (tags: TagOption[]) => void;
  roleName: string;
  setRoleName: (value: string) => void;
  saving: boolean;
  notice: string | null;
  onCancel: () => void;
  onSubmit: (event: FormEvent) => void;
}) {
  const isEdit = Boolean(draft.id);
  const title = isEdit ? "Edit report" : "Add report";
  const subtitle = isEdit ? "Update report details and access permissions." : "Configure report details and access permissions.";

  return (
    <div
      className="shrink-0 rounded-lg border bg-white p-4"
      style={{ borderColor: reportFormTheme.fieldBorder, boxShadow: reportFormTheme.shadow }}
    >
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 gap-2.5">
          <div
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
            style={{ backgroundColor: reportFormTheme.tealHeader, color: reportFormTheme.teal }}
          >
            <BarChart3 className="h-5 w-5" strokeWidth={2} aria-hidden />
          </div>
          <div className="min-w-0 pt-0.5">
            <h2 className="text-base font-semibold leading-tight text-slate-900">{title}</h2>
            <p className="text-xs text-slate-500">{subtitle}</p>
          </div>
        </div>
        <ApplicationTypeSelect
          provider={provider}
          disabled={isEdit}
          isEdit={isEdit}
          onChange={onProviderChange}
        />
      </div>

      <form onSubmit={onSubmit} className="space-y-3">
        {provider === DEFAULT_REPORT_PROVIDER ? (
          <>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
              <FormField label="Report name" required>
                <Input
                  className={fieldInputClass}
                  value={draft.name}
                  onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                  placeholder="Enter report name"
                  required
                />
              </FormField>
              <FormField label="Power BI report GUID" required>
                <Input
                  className={fieldInputClass}
                  value={draft.powerBiReportId}
                  onChange={(event) => setDraft({ ...draft, powerBiReportId: event.target.value })}
                  placeholder={GUID_PLACEHOLDER}
                  required
                />
              </FormField>
              <FormField label="Semantic model ID (GUID)" required>
                <Input
                  className={fieldInputClass}
                  value={draft.semanticModelId}
                  onChange={(event) => setDraft({ ...draft, semanticModelId: event.target.value })}
                  placeholder={GUID_PLACEHOLDER}
                  required
                  aria-label="Semantic model ID"
                />
              </FormField>
              <FormField label="Power BI workspace GUID" required>
                <Input
                  className={fieldInputClass}
                  value={draft.powerWorkSpaceId}
                  onChange={(event) => setDraft({ ...draft, powerWorkSpaceId: event.target.value })}
                  placeholder={GUID_PLACEHOLDER}
                  required
                />
              </FormField>
            </div>
            <FormField label="Description (optional)">
              <FormTextarea
                value={draft.description}
                onChange={(event) => setDraft({ ...draft, description: event.target.value })}
                placeholder="Enter a brief description of the report"
                rows={2}
              />
            </FormField>
          </>
        ) : (
          <div className="space-y-2">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <FormField label="Application name" required>
                <Input
                  className={cn(fieldInputClass, providerErrors.name ? "border-red-500" : "")}
                  value={draft.name}
                  onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                  placeholder="Enter application name"
                />
                {providerErrors.name ? <p className="text-xs text-red-600">{providerErrors.name}</p> : null}
              </FormField>
              <FormField label="Description (optional)">
                <FormTextarea
                  value={draft.description}
                  onChange={(event) => setDraft({ ...draft, description: event.target.value })}
                  placeholder="Enter a brief description"
                  rows={2}
                />
              </FormField>
            </div>
            <ProviderConfigFields
              provider={provider}
              values={providerValues}
              errors={providerErrors}
              onChange={onProviderValuesChange}
            />
            {getReportProvider(provider)?.status === "placeholder" && (
              <p className="text-xs text-slate-500">Placeholder provider: authentication and embedding are not implemented yet.</p>
            )}
          </div>
        )}

        <section
          className="overflow-hidden rounded-lg border"
          style={{ borderColor: reportFormTheme.tealBorder }}
        >
          <div
            className="flex items-center gap-2 border-b px-3 py-2"
            style={{ backgroundColor: reportFormTheme.tealHeader, borderColor: reportFormTheme.tealBorder }}
          >
            <Users className="h-4 w-4" style={{ color: reportFormTheme.teal }} aria-hidden />
            <span className="text-sm font-semibold text-slate-800">Access &amp; visibility</span>
          </div>
          <div className="grid grid-cols-1 gap-2 bg-white p-2 md:grid-cols-3 md:gap-3 md:p-3">
            <TagPicker
              compact
              label="Department / Category"
              placeholder="Search department or category"
              multiple={false}
              options={categories}
              selected={categoryTag}
              onChange={setCategoryTag}
            />
            <TagPicker compact label="Groups" placeholder="Search groups" options={groupOptions} selected={groupTags} onChange={setGroupTags} />
            <TagPicker compact label="Users" placeholder="Search users" options={userOptions} selected={userTags} onChange={setUserTags} />
          </div>
        </section>

        <div
          className="flex gap-2 rounded-md border px-3 py-2 text-xs leading-snug text-slate-600"
          style={{ backgroundColor: reportFormTheme.infoBanner, borderColor: reportFormTheme.infoBorder }}
        >
          <Info className="mt-0.5 h-4 w-4 shrink-0" style={{ color: reportFormTheme.navy }} aria-hidden />
          <p>
            Viewers see this report in the menu only when at least one group or user is mapped here (or they are a department admin for the
            category).
          </p>
        </div>
        {providerErrors.category ? <p className="text-xs text-red-600">{providerErrors.category}</p> : null}

        {notice ? <p className="text-xs text-amber-700">{notice}</p> : null}

        {provider === DEFAULT_REPORT_PROVIDER ? (
          <section className="space-y-2">
            <div className="flex flex-wrap items-center gap-x-6 gap-y-1">
              <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-slate-300 accent-[#0d9488]"
                  checked={draft.rlsEnabled}
                  onChange={(event) => setDraft({ ...draft, rlsEnabled: event.target.checked })}
                />
                Enable RLS
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-slate-300 accent-[#0d9488]"
                  checked={draft.enablePagination}
                  onChange={(event) => setDraft({ ...draft, enablePagination: event.target.checked })}
                />
                Enable pagination
              </label>
            </div>
            {draft.rlsEnabled ? (
              <div className="flex flex-wrap items-center gap-2 rounded-md border border-dashed border-slate-200 px-2 py-1.5">
                <span className="text-xs font-medium text-slate-600">RLS roles:</span>
                <Input
                  value={roleName}
                  onChange={(event) => setRoleName(event.target.value)}
                  placeholder="RLS role name"
                  className={cn(fieldInputClass, "h-8 max-w-[180px]")}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 border-slate-200 text-xs"
                  onClick={() => {
                    const name = roleName.trim();
                    if (!name) return;
                    setDraft({ ...draft, roles: [...draft.roles, { id: EMPTY, rlsRole: name }] });
                    setRoleName("");
                  }}
                >
                  Add role
                </Button>
                <div className="flex flex-wrap gap-1">
                  {draft.roles.map((role, index) => (
                    <button
                      key={`${role.id}-${role.rlsRole}-${index}`}
                      type="button"
                      className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] text-[#1d4e89] hover:bg-slate-50"
                      onClick={() => setDraft({ ...draft, roles: draft.roles.filter((_, item) => item !== index) })}
                    >
                      {role.rlsRole} ×
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </section>
        ) : null}

        <div className="flex justify-end gap-2 border-t border-slate-200 pt-3">
          <Button type="button" variant="outline" className="h-9 border-slate-200 px-4 shadow-none" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            type="submit"
            className="h-9 bg-[#0d9488] px-4 text-white shadow-none hover:bg-[#0f766e]"
            disabled={saving}
          >
            {provider !== DEFAULT_REPORT_PROVIDER ? "Validate configuration" : saving ? "Saving…" : isEdit ? "Save report" : "Create report"}
          </Button>
        </div>
      </form>
    </div>
  );
}