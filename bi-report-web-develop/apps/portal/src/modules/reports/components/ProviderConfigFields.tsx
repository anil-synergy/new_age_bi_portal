"use client";

import { Input } from "@/modules/shared/components/ui/input";
import { cn } from "@/lib/utils";
import { PROVIDER_CONFIG_FIELDS } from "../providers/registry";
import type { ProviderConfigValues } from "../providers/config-schema";
import type { ReportProviderId } from "../providers/types";

interface ProviderConfigFieldsProps {
  provider: Exclude<ReportProviderId, "power-bi">;
  values: ProviderConfigValues;
  errors: Record<string, string>;
  onChange: (values: ProviderConfigValues) => void;
}

export function ProviderConfigFields({ provider, values, errors, onChange }: ProviderConfigFieldsProps) {
  const fields = PROVIDER_CONFIG_FIELDS[provider];
  const set = (key: string, value: string) => onChange({ ...values, [key]: value });

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-3">
        {fields.map((field) => {
          const id = `provider-${provider}-${field.key}`;
          const error = errors[field.key];
          const control =
            field.kind === "select" ? (
              <select
                id={id}
                className={cn("h-10 w-full rounded-md border bg-background px-3 text-sm", error && "border-red-500")}
                value={values[field.key] ?? ""}
                onChange={(event) => set(field.key, event.target.value)}
              >
                {field.options?.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            ) : field.kind === "textarea" ? (
              <textarea
                id={id}
                rows={2}
                className={cn("w-full rounded-md border bg-background px-3 py-2 text-sm", error && "border-red-500")}
                value={values[field.key] ?? ""}
                placeholder={field.placeholder}
                onChange={(event) => set(field.key, event.target.value)}
              />
            ) : (
              <Input
                id={id}
                value={values[field.key] ?? ""}
                placeholder={field.placeholder}
                className={error ? "border-red-500" : ""}
                onChange={(event) => set(field.key, event.target.value)}
              />
            );
          return (
            <div key={field.key} className={field.kind === "textarea" ? "md:col-span-2 lg:col-span-3" : undefined}>
              <label htmlFor={id} className="text-xs font-medium text-slate-600">
                {field.label}
                {field.required && <span className="text-red-500"> *</span>}
              </label>
              {control}
              {error ? (
                <p className="mt-0.5 text-xs text-red-600">{error}</p>
              ) : (
                field.help && <p className="mt-0.5 text-xs text-slate-500">{field.help}</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
