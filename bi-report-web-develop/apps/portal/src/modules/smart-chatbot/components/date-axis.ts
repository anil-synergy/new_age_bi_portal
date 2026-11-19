import type { ChartPayload } from "@/types";

const ISOish = /^\d{4}-\d{2}-\d{2}/;

export const CHART_INSET_PX = 5;

export function parseChartDate(label: string): Date | null {
  if (!label || typeof label !== "string") return null;
  const trimmed = label.trim().slice(0, 10);
  if (!ISOish.test(trimmed)) return null;
  const d = new Date(`${trimmed}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function isDateSeriesChart(data: ChartPayload): boolean {
  if (data.type === "pie" || data.labels.length < 3) return false;
  const parsed = data.labels.map(parseChartDate).filter(Boolean) as Date[];
  if (parsed.length < Math.ceil(data.labels.length * 0.8)) return false;
  const sorted = [...parsed].sort((a, b) => a.getTime() - b.getTime());
  return sorted[0].getTime() !== sorted[sorted.length - 1].getTime();
}

const monthFmt = new Intl.DateTimeFormat("en", { month: "short" });
const yearFmt = new Intl.DateTimeFormat("en", { year: "numeric" });

/** Single x-axis with day ticks; month/year on boundary ticks only (no stacked offset bands). */
export function buildHierarchicalDateAxisOption(
  labels: string[],
  opts?: { labelColor?: string; compact?: boolean },
): Record<string, unknown> | null {
  if (labels.length < 2) return null;
  const dates = labels.map(parseChartDate);
  if (dates.some((d) => !d)) return null;

  const textColor = opts?.labelColor ?? "#64748b";
  const axisLineColor = opts?.labelColor ?? "#94a3b8";
  const compact = Boolean(opts?.compact);
  const fontSize = compact ? 8 : 10;
  const bottomPadding = CHART_INSET_PX + (compact ? 18 : 22);

  const monthEnds = new Set<number>();
  const yearEnds = new Set<number>();
  for (let i = 0; i < labels.length - 1; i++) {
    const a = dates[i]!;
    const b = dates[i + 1]!;
    if (a.getUTCMonth() !== b.getUTCMonth() || a.getUTCFullYear() !== b.getUTCFullYear()) monthEnds.add(i);
    if (a.getUTCFullYear() !== b.getUTCFullYear()) yearEnds.add(i);
  }

  const dayLabels = dates.map((d) => String(d!.getUTCDate()));

  return {
    grid: {
      bottom: bottomPadding,
      containLabel: true,
    },
    xAxis: {
      type: "category",
      data: dayLabels,
      boundaryGap: true,
      axisLine: { lineStyle: { color: axisLineColor } },
      axisTick: {
        show: true,
        alignWithLabel: false,
        interval: (index: number) => monthEnds.has(index) || yearEnds.has(index),
        length: 6,
        lineStyle: { color: axisLineColor, width: 1 },
      },
      axisLabel: {
        color: textColor,
        fontSize,
        margin: 4,
        hideOverlap: true,
        interval: compact ? "auto" : 0,
        formatter: (value: string, index: number) => {
          const d = dates[index];
          if (!d) return value;
          if (yearEnds.has(index)) return `${monthFmt.format(d)} ${yearFmt.format(d)}`;
          if (monthEnds.has(index)) return monthFmt.format(d);
          return value;
        },
      },
      splitLine: { show: false },
    },
  };
}