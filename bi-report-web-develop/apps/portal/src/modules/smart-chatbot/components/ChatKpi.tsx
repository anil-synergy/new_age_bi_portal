import type { KpiPayload } from "@/types";

export function ChatKpi({ data }: { data: KpiPayload }) {
  return (
    <div className="rounded-lg border border-[var(--smart-border)] bg-[color-mix(in_srgb,var(--smart-bubble-assistant)_85%,white)] p-4">
      <p className="text-xs uppercase tracking-wide text-[var(--smart-muted)]">{data.label}</p>
      <p className="mt-1 text-2xl font-bold text-[var(--smart-text)]">{data.value}</p>
      {data.delta && (
        <p className="mt-1 text-sm text-[var(--smart-accent)]">{data.delta}</p>
      )}
    </div>
  );
}
